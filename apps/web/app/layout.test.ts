import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { isReplayableImage, replayProperties, type Replayed } from "./customise/replay.ts";

const RESERVED = [
  "name",
  "status",
  "length",
  "top",
  "self",
  "parent",
  "origin",
  "closed",
  "opener",
  "frames",
  "history",
  "location",
  "navigator",
  "screen",
  "external",
  "event",
  "onerror",
];

const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

function scriptBodies(): string[] {
  return ["THEME_SCRIPT", "SW_CLEANUP_SCRIPT"].map((constant) => {
    const body = new RegExp(`const ${constant} = \`([^\`]*)\``).exec(source)?.[1];
    assert.ok(body !== undefined, `${constant} should be a closed template literal in layout.tsx`);
    return body;
  });
}

function withoutComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[^\S\n]*\/\/.*$/gm, " ");
}

test("the boot scripts declare no var that shadows a window property", () => {
  for (const body of scriptBodies()) {
    for (const [, identifier] of withoutComments(body).matchAll(/\bvar\s+([A-Za-z_$][\w$]*)/g)) {
      assert.ok(
        !RESERVED.includes(identifier),
        `var ${identifier} at global scope is window.${identifier} — rename it. ` +
          `Assigning a non-string to one of these coerces it, which is how ` +
          `var name turned a missing display name into the string "null".`,
      );
    }
  }
});

test("no backtick can appear inside the inline scripts", () => {
  for (const body of scriptBodies()) {
    assert.ok(!body.includes("`"), "a backtick inside the boot script would end the literal");
  }
});

test("no backslash can appear inside the inline scripts either", () => {
  // Every test in this file reads the raw text of the template literal, and the browser runs
  // what the literal evaluates to. A backslash is the one character where those two differ:
  // an escape written here is resolved before it ships, so a regex containing one is a
  // different regex in production than the one these tests are checking — silently, and in
  // the direction of permitting more. The scripts need none, so the rule is none.
  for (const body of scriptBodies()) {
    assert.ok(!body.includes("\\"), "write [/] and [(] rather than escaping them");
  }
});

function replayAll(stored: Record<string, string>): Replayed {
  const properties: Record<string, string> = {};
  const dataset: Record<string, string> = {};
  const documentElement = {
    dataset,
    style: {
      setProperty: (key: string, value: string) => {
        properties[key] = value;
      },
    },
  };
  const localStorage = { getItem: (key: string) => (key in stored ? stored[key]! : null) };

  runInNewContext(scriptBodies()[0]!, { document: { documentElement }, localStorage });
  return { properties, dataset };
}

function replay(stored: Record<string, string>): Record<string, string> {
  return replayAll(stored).properties;
}

const BANNER = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4";

test("a cached banner is replayed for the profile header, quoted as a CSS string", () => {
  const properties = replay({ "timbre:thumb-banner": BANNER });
  assert.equal(properties["--banner-thumb"], `url("${BANNER}")`);
});

test("only a data:image/ URL is replayed — storage is the reader's to edit", () => {
  for (const planted of ["https://example.com/pixel.png", "javascript:alert(1)", " data:image/png;base64,AA"]) {
    const properties = replay({ "timbre:thumb-banner": planted, "timbre:thumb-avatar": planted });
    assert.equal(properties["--banner-thumb"], undefined, `replayed ${planted}`);
    assert.equal(properties["--avatar-thumb"], undefined, `replayed ${planted}`);
  }
});

test("a quote planted in a thumbnail cannot close the url() early", () => {
  // Two locks on this door. The first is the shape: a thumbnail is what `canvas.toDataURL`
  // returns, base64 and nothing else, so a quote is not a character that can appear at all —
  // `data:image/` as a prefix test let everything after it through, including this. The
  // second is the quoting, asserted below on the value that would have been set: even a
  // thumbnail that somehow got past the first cannot end the url() early.
  const planted = 'data:image/png;base64,AA") , url("https://example.com/x.png';
  const properties = replay({ "timbre:thumb-banner": planted, "timbre:thumb-avatar": planted });

  assert.equal(properties["--banner-thumb"], undefined);
  assert.equal(properties["--avatar-thumb"], undefined);
  assert.ok(JSON.stringify(planted).includes('\\"'), "and the inner quote would be escaped");
});

test("a thumbnail that is not a raster data: URL is not replayed", () => {
  for (const planted of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png,%3Csvg%3E",
    "data:image/png;base64,AA,url(https://example.com/x.png)",
    "data:text/html;base64,AA",
  ]) {
    const properties = replay({ "timbre:thumb-banner": planted, "timbre:thumb-avatar": planted });
    assert.equal(properties["--banner-thumb"], undefined, `replayed ${planted}`);
    assert.equal(properties["--avatar-thumb"], undefined, `replayed ${planted}`);
  }
});

test("no banner, no banner variable", () => {
  const properties = replay({ "timbre:thumb-avatar": BANNER });
  assert.equal(properties["--banner-thumb"], undefined);
  assert.equal(properties["--avatar-thumb"], `url("${BANNER}")`, "the avatar is unaffected");
  assert.equal(properties["--avatar-letter"], "0");
});

test("the boot scripts are wrapped in try/catch", () => {
  for (const body of scriptBodies()) {
    assert.match(body.trimStart(), /^try\s*\{/, "the script must start with try {");
    assert.match(body.trimEnd(), /catch\s*\([\w$]*\)\s*\{[^}]*\}$/, "and end with a catch");
  }
});

// The boot script runs before React, before hydration, with every failure swallowed. Anything it
// writes to a custom property lands on <html> for the whole session. Three of its sinks took an
// arbitrary name or an arbitrary value from localStorage; --artwork-img and --profile-wash are
// both consumed by background-image, so a "colour" reading url(...) is a tracking pixel that
// fires before first paint, on every load, with no UI. CSP cannot stop it: img-src already
// permits https:. These tests are the control.

test("a planted palette variable cannot reach background-image", () => {
  const properties = replay({
    "timbre:palette": JSON.stringify({ vars: { "--artwork-img": "url(https://example.com/pixel.png)" } }),
  });
  assert.equal(properties["--artwork-img"], undefined);
});

test("only the variables the palette actually mints are replayed", () => {
  const properties = replay({
    "timbre:palette": JSON.stringify({ vars: { "--not-a-palette-var": "red", "--bg": "hsl(258 50% 7%)" } }),
  });
  assert.equal(properties["--not-a-palette-var"], undefined);
  assert.equal(properties["--bg"], "hsl(258 50% 7%)", "the allowlist still lets a real palette through");
});

test("an allowlisted name cannot carry an image value", () => {
  for (const planted of [
    "url(https://example.com/pixel.png)",
    "image-set('https://example.com/x.png' 1x)",
    "-webkit-image-set(url(x) 1x)",
    "element(#leak)",
    "var(--something-else)",
    "attr(href)",
    "red; background-image: url(https://example.com/x.png)",
  ]) {
    const properties = replay({ "timbre:palette": JSON.stringify({ vars: { "--accent": planted } }) });
    assert.equal(properties["--accent"], undefined, `replayed ${planted}`);
  }
});

test("a palette variable name is matched whole, not as a substring", () => {
  const properties = replay({ "timbre:palette": JSON.stringify({ vars: { "--fg-evil": "hsl(0 0% 0%)" } }) });
  assert.equal(properties["--fg-evil"], undefined, "--fg must not match inside --fg-evil");
});

// The positive control below is the value profile/profile-view.tsx actually stores, built the
// way it builds it. The previous one was a hand-written two-stop gradient, which is how a
// denylist containing "var(" shipped: it refused every real --profile-wash, because the real
// one ends at var(--surface-1), and the test never noticed because the test's gradient did
// not. A positive control that is a simplification of the real value is not a control.
const PROFILE_HUE = 258;
const PROFILE_SATURATION = 0.42;

function washStop(lightness: number, satScale = 1): string {
  return `hsl(${PROFILE_HUE} ${Math.round(PROFILE_SATURATION * satScale * 100)}% ${lightness}%)`;
}

const REAL_WASH = {
  dark: `linear-gradient(to bottom, ${washStop(34)} 0%, ${washStop(22, 0.8)} 45%, var(--surface-1) 100%)`,
  light: `linear-gradient(to bottom, ${washStop(84, 0.55)} 0%, ${washStop(91, 0.4)} 45%, var(--surface-1) 100%)`,
};

test("the wash this test replays is still the shape profile-view.tsx stores", () => {
  const view = readFileSync(new URL("./profile/profile-view.tsx", import.meta.url), "utf8");
  assert.match(
    view,
    /const washDark = `linear-gradient\(to bottom, \$\{stop\(\d+\)\} 0%, \$\{stop\([\d., ]+\)\} 45%, var\(--surface-1\) 100%\)`/,
    "profile-view.tsx changed the wash — update REAL_WASH here rather than weakening it",
  );
});

test("the real profile wash is replayed, var(--surface-1) and all", () => {
  const dark = replay({ "timbre:profile-wash": JSON.stringify(REAL_WASH) });
  assert.equal(dark["--profile-wash"], REAL_WASH.dark);

  const light = replay({
    "timbre:profile-wash": JSON.stringify(REAL_WASH),
    "timbre:palette": JSON.stringify({ vars: {}, theme: "light" }),
  });
  assert.equal(light["--profile-wash"], REAL_WASH.light, "the light ground picks the light wash");
});

test("the profile wash cannot become an outbound request", () => {
  for (const planted of [
    "url(https://example.com/pixel.png)",
    "image-set(url(https://example.com/x.png) 1x)",
    "linear-gradient(red, transparent), url(https://example.com/x.png)",
    // The point of allowing var() at all is that the names it can reach are a closed set, so
    // these are the two ways out of it: an unlisted name, and a fallback — which is a second
    // value hiding behind a comma.
    "linear-gradient(var(--not-a-palette-var) 0%, transparent 100%)",
    "linear-gradient(var(--surface-1, url(https://example.com/x.png)) 0%, transparent 100%)",
    "var(--surface-1);background-image:url(https://example.com/x.png)",
    "linear-gradient(red, transparent)/*)*/, url(https://example.com/x.png)",
  ]) {
    const properties = replay({ "timbre:profile-wash": JSON.stringify({ dark: planted }) });
    assert.equal(properties["--profile-wash"], undefined, `replayed ${planted}`);
  }
});

test("the avatar fill cannot become an outbound request", () => {
  const planted = replay({ "timbre:avatar-mono": JSON.stringify({ fill: "url(https://example.com/pixel.png)" }) });
  assert.equal(planted["--avatar-fill"], undefined);

  const real = replay({ "timbre:avatar-mono": JSON.stringify({ fill: "hsl(258 40% 40%)" }) });
  assert.equal(real["--avatar-fill"], "hsl(258 40% 40%)");
});

test("an absurdly long value is refused before anything parses it", () => {
  const properties = replay({
    "timbre:palette": JSON.stringify({ vars: { "--accent": "hsl(258 50% 50%)".padEnd(200, " ") } }),
  });
  assert.equal(properties["--accent"], undefined);
});

// ---------------------------------------------------------------------------------------
// The customisation surface: the reader's own picture behind the app, and the interface scale.
//
// This is the sink above, widened on purpose. theme/background.ts keeps a small copy of the
// picture in localStorage for one reason — so the boot script can paint it before the first
// frame — which puts a free-form string from storage inside a url() before React exists.
//
// Two implementations of one rule is how a rule rots, so there are not two: replay.ts calls
// the live path's own parseTheme() and backgroundVars(), and the corpus below goes through
// both it and the boot script with the results compared property by property.

const THEME_KEY = "timbre:theme";
const BG_KEY = "timbre:theme-bg";

function ground(dataset: Record<string, string>): "light" | "dark" {
  return dataset.theme === "light" ? "light" : "dark";
}

const CUSTOM_CORPUS: { why: string; theme: unknown; background: unknown }[] = [
  { why: "a picture with every knob set", theme: { background: { fit: "tile", dim: 0.8, blur: 12 }, textScale: 1.25 }, background: BANNER },
  { why: "a picture and nothing else", theme: {}, background: BANNER },
  { why: "a light ground under the picture", theme: { mode: "pastel", background: { fit: "contain" } }, background: BANNER },
  { why: "no picture at all", theme: { background: { fit: "tile" } }, background: null },
  { why: "a remote picture", theme: {}, background: "https://example.com/wallpaper.jpg" },
  { why: "a protocol-relative picture", theme: {}, background: "//example.com/wallpaper.jpg" },
  { why: "a blob: URL from a session that has ended", theme: {}, background: "blob:http://localhost:3000/9f0c-1" },
  { why: "an SVG document dressed as a picture", theme: {}, background: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
  { why: "a picture closing the url() early", theme: {}, background: 'data:image/png;base64,AA") , url("https://example.com/x.png' },
  { why: "a picture that is not base64 at all", theme: {}, background: "data:image/png,%3Csvg%3E" },
  { why: "a picture larger than storage should ever hold", theme: {}, background: `data:image/webp;base64,${"A".repeat(700_001)}` },
  { why: "dimming turned off", theme: { background: { dim: 0 } }, background: BANNER },
  { why: "dimming and blur past their ends", theme: { background: { dim: 4, blur: 400 } }, background: BANNER },
  { why: "dimming and blur that are not numbers", theme: { background: { dim: "0.9", blur: null } }, background: BANNER },
  { why: "a fit nobody offers", theme: { background: { fit: "parallax" } }, background: BANNER },
  { why: "a background that is not an object", theme: { background: "cover" }, background: BANNER },
  { why: "a text scale past its end", theme: { textScale: 9 }, background: null },
  { why: "a text scale below its start", theme: { textScale: 0.1 }, background: null },
  { why: "a text scale that is a string", theme: { textScale: "1.4" }, background: null },
  { why: "a theme that is not an object", theme: "dark", background: null },
];

function replayCustom(entry: { theme: unknown; background: unknown }): Replayed {
  const stored: Record<string, string> = { [THEME_KEY]: JSON.stringify(entry.theme) };
  if (typeof entry.background === "string") stored[BG_KEY] = entry.background;
  return replayAll(stored);
}

test("the boot script and the live path agree on every replayed customisation", () => {
  for (const entry of CUSTOM_CORPUS) {
    const replayed = replayCustom(entry);
    const expected = replayProperties(
      // What the script itself read: the parsed theme, and the picture as the raw string.
      { theme: entry.theme, background: entry.background },
      ground(replayed.dataset),
    );

    assert.deepEqual(replayed.properties, expected.properties, `properties disagreed on ${entry.why}`);
    assert.equal(replayed.dataset.bgImage, expected.dataset.bgImage, `the flag disagreed on ${entry.why}`);
  }
});

test("no replayed customisation can become an outbound request", () => {
  for (const entry of CUSTOM_CORPUS) {
    for (const value of Object.values(replayCustom(entry).properties)) {
      assert.doesNotMatch(
        value,
        /https?:|\/\/|blob:/,
        `${entry.why} put a URL the page will fetch onto the root`,
      );
    }
  }
});

test("only a picture this app encoded is replayed behind the app", () => {
  for (const entry of CUSTOM_CORPUS) {
    const replayed = replayCustom(entry);
    const allowed = isReplayableImage(entry.background);
    assert.equal(
      "--app-bg-image" in replayed.properties,
      allowed,
      `${entry.why}: the picture was ${allowed ? "refused" : "replayed"}`,
    );
    assert.equal(replayed.dataset.bgImage, allowed ? "true" : undefined, entry.why);
  }
});

test("the reader's picture and scale are on the root before React exists", () => {
  const { properties, dataset } = replayCustom({
    theme: { background: { fit: "tile", dim: 0.8, blur: 12 }, textScale: 1.25 },
    background: BANNER,
  });

  assert.equal(properties["--app-bg-image"], `url("${BANNER}")`);
  assert.equal(properties["--app-bg-size"], "auto");
  assert.equal(properties["--app-bg-repeat"], "repeat");
  assert.equal(properties["--app-bg-dim"], "0.8");
  assert.equal(properties["--app-bg-blur"], "12px");
  assert.equal(properties["--app-bg-scrim"], "#08080a", "the dark ground, because that is the ground");
  assert.equal(properties["--ui-scale"], "1.25");
  assert.equal(properties["font-size"], "125%");
  assert.equal(dataset.bgImage, "true");
});

test("the scrim follows the ground the page actually lands on", () => {
  const { properties } = replayAll({
    [THEME_KEY]: JSON.stringify({ mode: "pastel" }),
    [BG_KEY]: BANNER,
  });
  assert.equal(properties["--app-bg-scrim"], "#eef0f6");
});

test("the dimming that keeps text readable cannot be turned off from storage", () => {
  // Not a colour choice — a floor. A light photo under white text is unreadable at any accent,
  // so MIN_DIM in theme/custom-theme.ts is a floor the live path clamps to, and a boot script
  // that replayed a planted 0 would show one frame of exactly what the floor exists to stop.
  const { properties } = replayAll({
    [THEME_KEY]: JSON.stringify({ background: { dim: 0 } }),
    [BG_KEY]: BANNER,
  });
  assert.equal(properties["--app-bg-dim"], "0.3");
});

test("no font and no stylesheet can come from off this origin", () => {
  // The other half of theme/fonts.ts refusing a remote font: that refusal is a rule in code
  // someone can edit, and this is the policy the browser enforces whatever the code does. A
  // custom font is the one part of this surface that hands a picked file to a parser as
  // delicate as the font engine, and a remote one would hand a third party a hit on every
  // page load besides — so the directive names no scheme that leaves the machine.
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  const directive = (name: string) =>
    new RegExp(`"${name} ([^"]*)"`).exec(config)?.[1] ?? assert.fail(`${name} is missing`);

  assert.doesNotMatch(directive("font-src"), /https?:|\/\/|\*/, "font-src reaches off-origin");
  assert.doesNotMatch(directive("style-src"), /https?:|\/\/|\*/, "style-src reaches off-origin");
});
