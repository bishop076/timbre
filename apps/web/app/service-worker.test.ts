import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

/**
 * The worker's caching decisions, driven rather than read.
 *
 * `sw/sw.ts` cannot be imported: it has no exports on purpose, because next.config.ts transpiles
 * it to a classic script that `navigator.serviceWorker.register` loads without `type: "module"`,
 * and an `export` in that file is a worker that fails to install. So this does what the build
 * does — `ts.transpileModule`, the same options — and runs the result against a fake Cache API,
 * which is the only way to ask it what it would keep.
 *
 * It lives beside `service-worker.tsx`, the app-side half of the same feature, because the test
 * glob in apps/web/package.json covers `app/**` and `lib/**` and not `sw/**`.
 */

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ORIGIN = "https://timbre.test";
const BUILD = "9.9.9-abcdef123";

class FakeCache {
  readonly entries = new Map<string, Response>();

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response);
  }
  async match(request: Request | string): Promise<Response | undefined> {
    return this.entries.get(typeof request === "string" ? request : request.url);
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string): Promise<boolean> {
    return this.entries.delete(typeof request === "string" ? request : request.url);
  }
}

function harness(answer: (url: URL) => Response) {
  const caches = new Map<string, FakeCache>();
  const listeners = new Map<string, (event: unknown) => void>();
  const posted: unknown[] = [];
  const pending: Promise<unknown>[] = [];

  const cacheStorage = {
    async open(name: string) {
      const existing = caches.get(name) ?? new FakeCache();
      caches.set(name, existing);
      return existing;
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name: string) {
      return caches.delete(name);
    },
    async match(request: Request) {
      for (const cache of caches.values()) {
        const hit = await cache.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    location: { href: `${ORIGIN}/sw.js?v=${BUILD}`, origin: ORIGIN },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [{ postMessage: (message: unknown) => posted.push(message) }],
    },
  };

  const source = readFileSync(new URL("../sw/sw.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "sw.ts",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });

  runInNewContext(outputText, {
    self,
    caches: cacheStorage,
    fetch: async (request: Request) => answer(new URL(typeof request === "string" ? request : request.url)),
    URL,
    Request,
    Response,
    Headers,
    Promise,
  });

  /** Runs one navigation through the worker and settles whatever it deferred. */
  async function navigate(path: string): Promise<Response | undefined> {
    const request = new Request(ORIGIN + path);
    Object.defineProperty(request, "mode", { value: "navigate" });
    let answered: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request,
      respondWith: (value: Promise<Response>) => {
        answered = value;
      },
      waitUntil: (value: Promise<unknown>) => pending.push(value),
    });
    const response = await answered;
    await Promise.allSettled(pending.splice(0));
    // The write is deliberately deferred inside a waitUntil, so a second drain settles it.
    await Promise.allSettled(pending.splice(0));
    return response;
  }

  async function urls(name: string): Promise<string[]> {
    return [...(caches.get(name)?.entries.keys() ?? [])];
  }

  return { listeners, caches, cacheStorage, posted, pending, navigate, urls };
}

const page = (headers: Record<string, string> = {}) =>
  new Response("<!doctype html><title>page</title>", {
    status: 200,
    headers: { "content-type": "text/html", ...headers },
  });

const SHELL = `timbre-shell-${BUILD}`;

test("a document the server refused to let anyone store is not stored here either", async () => {
  // /playlist/[id] is a dynamic route, so Next answers it `private, no-cache, no-store,
  // max-age=0, must-revalidate`. The worker's path list names /profile and /spotify and knew
  // nothing about it, so every playlist page a reader opened was written to disk anyway —
  // which is the one thing `no-store` is for.
  const sw = harness((url) =>
    url.pathname.startsWith("/playlist/")
      ? page({ "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate" })
      : page({ "cache-control": "s-maxage=31536000" }),
  );

  await sw.navigate("/library");
  await sw.navigate("/playlist/the-one-with-the-name");

  assert.deepEqual(await sw.urls(SHELL), [`${ORIGIN}/library`], "only the cacheable page was kept");
});

test("the API and the two account routes are never asked to be cached at all", async () => {
  const sw = harness(() => page());
  for (const path of ["/api/search?q=x", "/profile", "/spotify/callback?code=secret"]) {
    const answered = await sw.navigate(path);
    assert.equal(answered, undefined, `${path} should be left to the browser`);
  }
  assert.deepEqual(await sw.urls(SHELL), []);
});

test("the shelf of documents keeps its limit when every page shares one path", async () => {
  // An entry's key is the whole URL, so `/?from=a` and `/?from=b` are two copies of the home
  // page — and `protect` was matched against the pathname, so all of them counted as the
  // precached "/". The filter then had nothing left to delete and the cap silently stopped
  // being a cap: 70 navigations produced 73 stored documents against a limit of 50.
  const sw = harness(() => page({ "cache-control": "s-maxage=31536000" }));

  for (let n = 0; n < 70; n++) await sw.navigate(`/?n=${n}`);

  const kept = await sw.urls(SHELL);
  assert.ok(kept.length <= 50, `the shell cache held ${kept.length} documents, limit is 50`);
  assert.ok(kept.includes(`${ORIGIN}/?n=69`), "the most recent page is the one worth having");
});

test("the three routes installed with the worker survive a shelf that overflows", async () => {
  const sw = harness(() => page({ "cache-control": "s-maxage=31536000" }));
  await sw.navigate("/");
  await sw.navigate("/explore");
  await sw.navigate("/library");
  for (let n = 0; n < 70; n++) await sw.navigate(`/album/${n}`);

  const kept = await sw.urls(SHELL);
  for (const path of ["/", "/explore", "/library"]) {
    assert.ok(kept.includes(ORIGIN + path), `${path} should still be there offline`);
  }
});

test("a page that is not in the cache and not on the network says so, and is not stored", async () => {
  const sw = harness(() => {
    throw new TypeError("Failed to fetch");
  });
  const answered = await sw.navigate("/album/does-not-exist");
  assert.equal(answered?.status, 503);
  assert.equal(answered?.headers.get("cache-control"), "no-store");
  assert.match(await answered!.text(), /No connection/);
  assert.deepEqual(await sw.urls(SHELL), [], "the offline page is not itself cached");
});
