import assert from "node:assert/strict";
import { test } from "node:test";

import { dataUrlToBlob, readProfileExport } from "./profile-file.ts";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("a profile with a name and pictures is read as-is", () => {
  assert.deepEqual(readProfileExport({ name: "Bishop", avatar: PNG, banner: null }), {
    name: "Bishop",
    avatar: PNG,
    banner: null,
  });
});

test("an empty profile is no profile, so an import does not offer one", () => {
  assert.equal(readProfileExport({ name: "  ", avatar: null, banner: null }), null);
  assert.equal(readProfileExport(null), null);
  assert.equal(readProfileExport("Bishop"), null);
});

test("only raster data URLs survive — SVG is a document, and a URL is a request", () => {
  const read = (avatar: unknown) => readProfileExport({ name: "x", avatar, banner: null })?.avatar;
  assert.equal(read("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(read("https://attacker.example/me.png"), null);
  assert.equal(read("data:text/html;base64,PGgxPg=="), null);
  assert.equal(read(`${PNG}"onerror="x`), null);
  assert.equal(read(42), null);
  assert.equal(read(PNG), PNG);
});

test("a data URL's bytes come back with its type", async () => {
  const blob = dataUrlToBlob("data:image/jpeg;base64,/9j/4AAQ");
  assert.equal(blob.type, "image/jpeg");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
});
