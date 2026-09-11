import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

/*
 * The boot script runs at global scope in the document head, so every `var` it
 * declares is a property of `window` — and a handful of those names already
 * exist and are typed.
 *
 * `var name = localStorage.getItem(...)` shipped for a while. `window.name` is a
 * DOMString, so assigning null stored the *string* `"null"`, which is truthy — the
 * guard passed and every reader without a saved display name got
 * `--profile-name: "null"`, rendering the word "null" in the sidebar until
 * hydration. Nothing about it looks wrong when you read it.
 *
 * This reads the file as text rather than importing it: the module is a server
 * component that pulls in next/font, and the value under test is a string
 * constant, so parsing is the cheaper and more direct check.
 */

/** Window properties that a bare `var` in global scope would collide with. */
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

/** The inline scripts, by the template literals they are declared in. */
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

/** Comments stripped, or a note *about* `var name` reads as a declaration of it. */
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
  // A backtick ends the template literal and breaks the root layout, so every page
  // 500s. It has happened three times, twice from a comment.
  for (const body of scriptBodies()) {
    assert.ok(!body.includes("`"), "a backtick inside the boot script would end the literal");
  }
});

/**
 * Runs the theme script against a stand-in `<html>` and a stand-in `localStorage`, and hands
 * back the custom properties it set. Run rather than read, because what matters is what a
 * stored value turns into — and a planted value is what these tests are about.
 */
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
  // Anything else would point a background at a host of whoever wrote the value's choosing.
  for (const planted of ["https://example.com/pixel.png", "javascript:alert(1)", " data:image/png;base64,AA"]) {
    const properties = replay({ "timbre:thumb-banner": planted, "timbre:thumb-avatar": planted });
    assert.equal(properties["--banner-thumb"], undefined, `replayed ${planted}`);
    assert.equal(properties["--avatar-thumb"], undefined, `replayed ${planted}`);
  }
});

test("a quote planted in a thumbnail cannot close the url() early", () => {
  // Concatenated between literal quotes, as the avatar's was, this value ended the string
  // and left the rest as CSS. Escaped, it stays one (broken) URL.
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
  // Storage throws rather than returning null in private browsing, and an exception
  // in a blocking head script stops the document rendering.
  for (const body of scriptBodies()) {
    assert.match(body.trimStart(), /^try\s*\{/, "the script must start with try {");
    assert.match(body.trimEnd(), /catch\s*\([\w$]*\)\s*\{[^}]*\}$/, "and end with a catch");
  }
});
