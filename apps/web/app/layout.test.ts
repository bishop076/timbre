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
  const bodies: string[] = [];
  for (const constant of ["THEME_SCRIPT", "SW_CLEANUP_SCRIPT"]) {
    const marker = `const ${constant} = \``;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${constant} should exist in layout.tsx`);
    const from = start + marker.length;
    const end = source.indexOf("`", from);
    assert.notEqual(end, -1, `${constant} should be a closed template literal`);
    bodies.push(source.slice(from, end));
  }
  return bodies;
}

function withoutComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[^\S\n]*\/\/.*$/gm, " ");
}

test("the boot scripts declare no var that shadows a window property", () => {
  for (const body of scriptBodies()) {
    const declared = [...withoutComments(body).matchAll(/\bvar\s+([A-Za-z_$][\w$]*)/g)].map(
      (m) => m[1]!,
    );
    for (const identifier of declared) {
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
