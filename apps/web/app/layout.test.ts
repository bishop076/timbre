import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

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

function replay(stored: Record<string, string>): Record<string, string> {
  const properties: Record<string, string> = {};
  const documentElement = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (key: string, value: string) => {
        properties[key] = value;
      },
    },
  };
  const localStorage = { getItem: (key: string) => (key in stored ? stored[key]! : null) };

  runInNewContext(scriptBodies()[0]!, { document: { documentElement }, localStorage });
  return properties;
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
  const planted = 'data:image/png;base64,AA") , url("https://example.com/x.png';
  const properties = replay({ "timbre:thumb-banner": planted, "timbre:thumb-avatar": planted });

  const expected = `url(${JSON.stringify(planted)})`;
  assert.equal(properties["--banner-thumb"], expected);
  assert.equal(properties["--avatar-thumb"], expected);
  assert.ok(expected.includes('\\"'), "the inner quote is escaped");
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

test("the profile wash cannot become an outbound request", () => {
  const planted = replay({
    "timbre:profile-wash": JSON.stringify({ dark: "url(https://example.com/pixel.png)" }),
  });
  assert.equal(planted["--profile-wash"], undefined);

  const real = replay({
    "timbre:profile-wash": JSON.stringify({ dark: "linear-gradient(hsl(258 40% 10%), transparent)" }),
  });
  assert.equal(real["--profile-wash"], "linear-gradient(hsl(258 40% 10%), transparent)");
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
