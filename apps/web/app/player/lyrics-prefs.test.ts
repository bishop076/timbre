import assert from "node:assert/strict";
import { test } from "node:test";

import { readPrefs } from "./lyrics-prefs.ts";

test("the stored file is held to its size on the way in, not only on the way out", () => {
  const stored: Record<string, unknown> = {};
  for (let index = 0; index < 400; index += 1) stored[`song-${index}`] = { offset: 1.5 };

  const prefs = readPrefs(stored);

  // `update` trims to 300 on write and the read took whatever it found, so a file left longer
  // by an older build, a hand edit or a tab on different code came back at its full length and
  // stayed — a write only removes the excess that one write creates.
  assert.equal(Object.keys(prefs).length, 300);
  assert.ok(prefs["song-399"], "the newest entry survives");
  assert.equal(prefs["song-0"], undefined, "the oldest is dropped, as the write path drops it");
});

test("an offset that is not a number never reaches the panel", () => {
  // `LyricsPanel` renders `offset.toFixed(1)`, so a string here is a TypeError in render and
  // the player panel goes down with it.
  assert.deepEqual(readPrefs({ "a::b": { offset: "1" } }), {});
  assert.deepEqual(readPrefs({ "a::b": { offset: null } }), {});
  assert.deepEqual(readPrefs({ "a::b": { offset: {} } }), {});

  // `line.at <= position + NaN` is false for every line, so the lyrics stop following with
  // nothing on screen to say why.
  assert.deepEqual(readPrefs({ "a::b": { offset: Number.NaN } }), {});
  assert.deepEqual(readPrefs({ "a::b": { offset: Number.POSITIVE_INFINITY } }), {});
});

test("an offset no nudge could have reached is brought back into range", () => {
  assert.deepEqual(readPrefs({ "a::b": { offset: 1e12 } }), { "a::b": { offset: 600 } });
  assert.deepEqual(readPrefs({ "a::b": { offset: -1e12 } }), { "a::b": { offset: -600 } });
  assert.deepEqual(readPrefs({ "a::b": { offset: -2.5 } }), { "a::b": { offset: -2.5 } });
});

test("an id has to be one a lyrics service could answer to", () => {
  assert.deepEqual(readPrefs({ "a::b": { id: 42 } }), { "a::b": { id: 42 } });
  assert.deepEqual(readPrefs({ "a::b": { id: "42" } }), {});
  assert.deepEqual(readPrefs({ "a::b": { id: 1.5 } }), {});
  assert.deepEqual(readPrefs({ "a::b": { id: -1 } }), {});
  assert.deepEqual(readPrefs({ "a::b": { id: Number.NaN } }), {});
});

test("the only provider that can be remembered is the one that can be asked", () => {
  assert.deepEqual(readPrefs({ "a::b": { provider: "ytmusic" } }), {
    "a::b": { provider: "ytmusic" },
  });
  assert.deepEqual(readPrefs({ "a::b": { provider: "https://example.invalid" } }), {});
});

test("an entry carrying nothing is not worth a place in the file", () => {
  // Clearing a nudge stores `{}` rather than removing the key, so these used to fill the cap
  // with choices that no longer exist.
  assert.deepEqual(readPrefs({ "a::b": {}, "c::d": { offset: 0 }, "e::f": { offset: 2 } }), {
    "e::f": { offset: 2 },
  });
});

test("nothing readable stays nothing", () => {
  assert.deepEqual(readPrefs(null), {});
  assert.deepEqual(readPrefs("a string"), {});
  assert.deepEqual(readPrefs(7), {});
  assert.deepEqual(readPrefs([{ offset: 1 }]), {});
  assert.deepEqual(readPrefs({ "a::b": null }), {});
  assert.deepEqual(readPrefs({ "a::b": [1, 2] }), {});
});
