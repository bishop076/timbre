import assert from "node:assert/strict";
import { test } from "node:test";

import { SOURCE_STYLES, sourceStyle } from "./sources.ts";

/**
 * The names JavaScript answers to whether or not anybody put them in the table. `__proto__` is
 * the odd one: it comes back as `Object.prototype` itself rather than as a function, so it is
 * not nullish either and `??` never fired for it.
 */
const INHERITED = [
  "constructor",
  "__proto__",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
];

test("a source Timbre knows keeps its own name and colour", () => {
  assert.deepEqual(sourceStyle("spotify"), {
    label: "Spotify",
    short: "Spotify",
    color: "#1ed760",
  });
  assert.equal(sourceStyle("ytmusic").short, "YT Music");
});

/**
 * `sourceStyle("constructor")` used to hand back the `Object` constructor. Nothing threw: every
 * caller reads `.label`, `.short` or `.color` off it, and a function has none of those, so
 * `source-badges.tsx` rendered `Open on undefined` and a badge with no text in it, `player-bar`
 * showed a blank source chip and `rankings-view` wrote "undefined did not answer". `usableSong`
 * copies `source` through unchanged, so one planted entry in `timbre:likes` was enough.
 */
test("a source nobody knows falls back to its own id, including the names Object answers to", () => {
  for (const id of ["banana", ...INHERITED]) {
    const style = sourceStyle(id);
    assert.equal(typeof style, "object", `${id} did not come back as a style`);
    assert.deepEqual(style, { label: id, short: id, color: "var(--muted)" }, `${id} fell through`);
  }
});

/** The three fields are all any call site reads, so this covers every one of them at once. */
test("every field a call site renders is a string, whatever the id was", () => {
  for (const id of ["", " ", "banana", ...INHERITED]) {
    const { label, short, color } = sourceStyle(id);
    for (const [name, value] of Object.entries({ label, short, color })) {
      assert.equal(typeof value, "string", `sourceStyle(${JSON.stringify(id)}).${name}`);
    }
  }
});

test("the table itself cannot be asked for a name it does not hold", () => {
  for (const id of INHERITED) {
    assert.equal(SOURCE_STYLES.get(id), undefined, `${id} is answerable from the table`);
  }
  assert.equal(SOURCE_STYLES.get("deezer")?.label, "Deezer");
});
