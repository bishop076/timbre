// The gate this repo did not have: a production build, loaded in a real browser.
//
// Three bugs were all live in production while `pnpm typecheck`, `pnpm lint`, the
// whole unit suite and `pnpm build` were green — because none of them ever opens a page. Every
// one of the three was found by reading a browser's console or network panel, which is exactly
// what this script automates.
//
// It drives Chrome over the DevTools Protocol with nothing but Node builtins. Playwright would
// be shorter and is the obvious tool, but "no new dependency without asking" is an
// architecture gate with a test behind it (scripts/deps.test.mts), and nobody was there to ask.
// Swapping this file's bottom half for `playwright-core` is a contained change if that answer
// is ever yes; everything above `--- Chrome ---` would stay as it is.
//
// What it deliberately does NOT assert: anything that depends on an upstream answering. A CI
// runner has no Spotify credentials, no sidecar, and an address Deezer may well throttle, so
// "the shelf has songs in it" would fail for reasons that are nobody's bug. Provider-backed
// `/api/*` responses are reported and not gated. What *is* gated is the app's own shell — the
// document, its scripts, its styles, its boot — which is where all three bugs actually were.
//
// Usage:
//   TIMBRE_DIST_DIR=.next-prod NODE_ENV=production pnpm --filter @timbre/web build
//   ... start `next start` on $SMOKE_BASE_URL ...
//   node apps/web/e2e/smoke.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3100";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..");
const DIST = path.join(WEB, process.env.TIMBRE_DIST_DIR ?? ".next");

// Static routes only. `/album/[id]`, `/artist/[name]` and `/collection/...` are every bit as
// worth loading, and are left out on purpose: each one server-renders from Deezer, so a
// throttled runner would fail the build for an outage upstream. They are the first thing to
// add if this ever runs somewhere with a warm cache.
//
// `SMOKE_ROUTES` narrows the list — one route while chasing something, or a page written to
// provoke a detector on purpose, which is how the two below were shown to fire at all.
const ROUTES = process.env.SMOKE_ROUTES?.split(",").filter(Boolean) ?? [
  "/",
  "/explore",
  "/library",
  "/liked",
  "/rankings",
  "/stats",
  "/profile",
  "/about",
  "/privacy",
  "/search?q=bicep",
];

const failures = [];
const warnings = [];
const fail = (route, message) => failures.push(`${route}: ${message}`);
const warn = (route, message) => warnings.push(`${route}: ${message}`);

// Runs before any of the app's own script does, in every document.
//
// The first half is the CSP bug: a CSP violation is reported on an event and nowhere else, and the
// dev server sends a different policy — `'unsafe-eval'` and all — so this can only ever be
// checked against a production build.
//
// The second half is the boot-script bug in its general form. A custom property takes very
// nearly any token stream — `rgb(oops)` is stored happily and only fails where it is *used* —
// so what this catches is the narrower, nastier set the parser throws out outright: an
// unmatched `}` or `]`, a top-level `;` or `!`. Those are exactly what arrives when stored text
// is written into CSS without being parsed first, and `setProperty` does not throw on them: it
// returns quietly and the property keeps nothing. Reading the value straight back off the same
// declaration is the only moment that rejection is visible. An empty or blank value is not a
// rejection — it reads back empty because it *is* empty.
const WATCHER = () => {
  const violations = [];
  const rejected = [];
  Object.defineProperty(window, "__smoke", { value: { violations, rejected } });

  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push(`${event.effectiveDirective} blocked ${event.blockedURI || "inline"}`);
  });

  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    setProperty.call(this, name, value, priority);
    const written = value === null || value === undefined ? "" : String(value);
    if (String(name).startsWith("--") && written.trim() !== "") {
      if (this.getPropertyValue(name) === "") rejected.push(`${name}: ${written}`);
    }
  };
};

const sameOrigin = (url) => typeof url === "string" && url.startsWith(BASE);

async function visit(chrome, route) {
  const tab = await chrome.tab();

  const consoleErrors = [];
  const crashes = [];
  const badRequests = new Map();
  let documentStatus = 0;

  tab.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    crashes.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  // Two separate sources, which is why both are listened to: `console.error(...)` from the
  // app's own code arrives on Runtime, while the browser's own complaints — a subresource that
  // 404ed, a script the policy refused to run — arrive on Log and nowhere else.
  tab.on("Runtime.consoleAPICalled", ({ type, args, stackTrace }) => {
    if (type !== "error") return;
    const from = stackTrace?.callFrames?.[0]?.url ?? "";
    if (from !== "" && !sameOrigin(from)) return;
    consoleErrors.push(args.map((a) => a.value ?? a.description ?? a.type).join(" "));
  });
  tab.on("Log.entryAdded", ({ entry }) => {
    if (entry.level !== "error") return;
    // A failed request already arrives below, where the status is visible and `/api/art`
    // answering 502 can be told from it answering 403. The console's version of the same event
    // is just "Failed to load resource", which has no status to judge — counting it too made a
    // throttled cover upstream fail the gate twice over.
    if (entry.source === "network") return;
    // Anything a third-party embed says about itself is not this app's bug, and a runner with
    // no Spotify credentials will hear plenty of it. Keep only what same-origin code said.
    if (entry.url !== undefined && !sameOrigin(entry.url)) return;
    consoleErrors.push(entry.text);
  });
  tab.on("Network.responseReceived", ({ type, response }) => {
    if (type === "Document" && documentStatus === 0) documentStatus = response.status;
    if (!sameOrigin(response.url) || response.status < 400) return;
    const at = new URL(response.url).pathname;
    // `/api/art` answering 403 is the allowlist bug exactly: it refused a cover this app itself
    // minted the URL for, which is a bug in the allowlist and never an upstream blip. The
    // route says 502 or 404 when the blame is upstream, so those two are only reported.
    const upstream = at.startsWith("/api/") && response.status !== 403;
    const line = `${response.status} ${at}`;
    const already = badRequests.get(line);
    if (already) already.count += 1;
    else badRequests.set(line, { upstream, count: 1 });
  });

  try {
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    await tab.send("Log.enable");
    await tab.send("Network.enable");
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${WATCHER})()` });

    const loaded = tab.once("Page.loadEventFired", 30_000);
    const { errorText } = await tab.send("Page.navigate", { url: BASE + route });
    if (errorText) throw new Error(errorText);
    await loaded;
    // Long enough for the boot script, hydration and the first effects; short enough that ten
    // routes stay inside a minute. Nothing here waits on a network answer.
    await sleep(1_200);

    const seen = await tab.evaluate(`({
      violations: window.__smoke.violations,
      rejected: window.__smoke.rejected,
      text: (document.body && document.body.innerText || "").trim().length,
    })`);

    if (documentStatus !== 200) fail(route, `document answered ${documentStatus || "nothing"}`);
    for (const violation of new Set(seen.violations)) fail(route, `CSP: ${violation}`);
    for (const property of new Set(seen.rejected)) {
      fail(route, `the boot script set a custom property the engine rejected — ${property}`);
    }
    // A blank <body> is a hydration crash that threw nothing, which no other gate here sees.
    if (seen.text === 0) fail(route, "rendered an empty body");
  } catch (error) {
    fail(route, `did not load — ${error.message.split("\n")[0]}`);
  } finally {
    for (const crash of new Set(crashes)) fail(route, `uncaught: ${crash}`);
    for (const message of new Set(consoleErrors)) fail(route, `console.error: ${message}`);
    for (const [line, { upstream, count }] of badRequests) {
      (upstream ? warn : fail)(route, count > 1 ? `${line} (${count}x)` : line);
    }
    await tab.close();
  }
}

// The other half of the same bug: an unsupported link is "that link isn't from a service Timbre can play"
// (404), not "the service wouldn't answer" (502). Blaming an outage for a link nobody was ever
// going to be asked about sent the reader off to check a URL that was fine.
//
// Only conclusive with the ytmusic sidecar up, which is why 502 is reported rather than gated:
// the resolver asks ytmusic about any host no other provider claims, and a refused connection
// is a real failure that legitimately produces a 502. Run the sidecar alongside this and the
// warning becomes an assertion — see the `ytmusic` job in ci.yml for the container.
async function checkResolve() {
  const route = "/api/resolve";
  const link = encodeURIComponent("https://example.com/nope");
  const response = await fetch(`${BASE}/api/resolve?url=${link}`);
  const body = await response.json().catch(() => ({}));

  if (response.status === 502) {
    const sources = (body.failures ?? []).map((failure) => failure.source).join(", ");
    warn(route, `an unsupported link answered 502; ${sources || "nothing"} was unreachable`);
  } else if (response.status !== 404) {
    fail(route, `an unsupported link answered ${response.status}, not 404`);
  }

  // This half needs nothing running: the schema refuses the value before a provider is asked.
  const malformed = await fetch(`${BASE}/api/resolve?url=not-a-url`);
  if (malformed.status !== 400) {
    fail(route, `a malformed link answered ${malformed.status}, not 400`);
  }
  await malformed.arrayBuffer();
}

// The og image is generated at request time from three woff files, and its documented failure
// mode is silent: Satori falls back per glyph rather than throwing, so a build that hands every
// face the same bytes still returns a plausible picture. Two halves, then — the route has to
// answer with a PNG of the right size, and the build has to have emitted three *distinct*
// faces. See the comment above FONT_URLS in app/opengraph-image.tsx.
async function checkOpenGraphImage() {
  const route = "/opengraph-image";
  const response = await fetch(BASE + route);
  if (response.status !== 200) return fail(route, `answered ${response.status}`);

  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/png")) fail(route, `content-type was ${type || "absent"}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000) return fail(route, `only ${bytes.length} bytes — nothing was drawn`);
  // IHDR: width and height are the two big-endian words after the 8-byte signature and the
  // 8-byte chunk header.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1200 || height !== 400) fail(route, `is ${width}x${height}, not 1200x400`);
}

function digestsUnder(directory) {
  const found = new Map();
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".woff")) {
        found.set(createHash("sha256").update(readFileSync(full)).digest("hex"), full);
      }
    }
  };
  walk(directory);
  return found;
}

function checkBrandFontsAreDistinct() {
  const route = "opengraph-image fonts";
  const source = path.join(WEB, "app", "brand-fonts");

  let wanted;
  try {
    wanted = digestsUnder(source);
  } catch {
    return warn(route, `no brand-fonts directory at ${source} — skipped`);
  }
  if (wanted.size < 2) return warn(route, "fewer than two source faces — nothing to compare");

  let built;
  try {
    statSync(DIST);
    built = digestsUnder(DIST);
  } catch {
    return warn(route, `no build output at ${DIST} — skipped`);
  }

  const missing = [...wanted].filter(([digest]) => !built.has(digest));
  if (missing.length > 0) {
    fail(
      route,
      `${missing.length} of ${wanted.size} faces were not emitted into the build ` +
        `(${missing.map(([, file]) => path.basename(file)).join(", ")}). A template literal in ` +
        `new URL() collapses them onto one asset, and the image still renders — in the wrong font.`,
    );
  }
}

// --- Chrome -----------------------------------------------------------------------------
// Enough of the DevTools Protocol to open a tab, listen to it and read a value out. Node has
// had a WebSocket client since 22.4, which is the whole reason this fits in a page.

function chromeBinary() {
  if (process.env.SMOKE_CHROME) return process.env.SMOKE_CHROME;
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
          ];
  return candidates.find((candidate) => existsSync(candidate));
}

class Tab {
  #socket;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== undefined) {
        const waiting = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (!waiting) return;
        if (message.error) waiting.reject(new Error(message.error.message));
        else waiting.resolve(message.result);
        return;
      }
      for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(`could not attach to ${url}`)), {
        once: true,
      });
    });
    return new Tab(socket);
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(listener);
  }

  once(event, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
      this.on(event, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }

  close() {
    this.#socket.close();
  }
}

async function launchChrome() {
  const binary = chromeBinary();
  if (!binary) {
    throw new Error(
      "no Chrome or Chromium found. Set SMOKE_CHROME to its path — GitHub's ubuntu runners " +
        "ship /usr/bin/google-chrome, which is what this looks for first.",
    );
  }

  const profile = mkdtempSync(path.join(os.tmpdir(), "timbre-smoke-"));
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      // A throwaway profile pointed at localhost for one run. The sandbox is off because CI
      // containers routinely cannot grant it, and there is nothing here worth sandboxing.
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const endpoint = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Chrome never reported a debugging port")), 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      buffer += chunk;
      const found = /ws:\/\/[^\s]+/.exec(buffer);
      if (!found) return;
      clearTimeout(timer);
      resolve(found[0]);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with ${code} before it was ready`));
    });
  });

  const origin = new URL(endpoint.replace(/^ws/, "http")).origin;

  return {
    // A fresh tab per route: cheap, and it keeps one page's storage and listeners out of the
    // next one's way.
    async tab() {
      const created = await fetch(`${origin}/json/new?about:blank`, { method: "PUT" });
      const { webSocketDebuggerUrl, id } = await created.json();
      const tab = await Tab.open(webSocketDebuggerUrl);
      const close = tab.close.bind(tab);
      tab.close = async () => {
        close();
        await fetch(`${origin}/json/close/${id}`).catch(() => {});
      };
      return tab;
    },
    async kill() {
      child.kill();
      await sleep(500);
      // Best effort: Windows keeps a handle on the profile for a moment after the process
      // goes, and a temp directory left behind must never be what fails the gate.
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        /* the OS will clear it */
      }
    },
  };
}

async function main() {
  let chrome;
  try {
    chrome = await launchChrome();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const started = Date.now();
  try {
    for (const route of ROUTES) await visit(chrome, route);
    await checkResolve();
    await checkOpenGraphImage();
    checkBrandFontsAreDistinct();
  } finally {
    await chrome.kill();
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  for (const line of warnings) console.log(`  warn  ${line}`);
  for (const line of failures) console.log(`  FAIL  ${line}`);
  console.log(
    `\n${ROUTES.length} routes + 3 checks in ${seconds}s — ` +
      `${failures.length} failed, ${warnings.length} reported.`,
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

await main();
