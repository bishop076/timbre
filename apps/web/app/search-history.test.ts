import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forgetSearch,
  hideSuggestion,
  parseHidden,
  parseSearches,
  rememberSearch,
  showSuggestionsAgain,
  withSearch,
} from "./search-history.ts";
import { MAX_QUERY } from "./search-url.ts";

/**
 * The stored value is the reader's own, which is exactly why nothing may assume its shape: it
 * survives every build, it is one devtools panel away from being hand-edited, and a second tab
 * running an older version writes it too. The recurring bug here is "a value out of storage reached
 * code that assumed its shape", five times over in this codebase.
 */
test("a search record of any shape at all comes back as a list of queries", () => {
  for (const junk of [
    null,
    undefined,
    42,
    "nils frahm",
    { 0: "nils frahm", length: 1 },
    { recent: ["nils frahm"] },
    true,
  ]) {
    assert.deepEqual(parseSearches(junk), [], `${JSON.stringify(junk)} is not a list of searches`);
  }

  // An array whose members are the wrong type: each one is skipped, the good ones survive.
  assert.deepEqual(parseSearches([1, null, {}, [], "four tet", undefined, "burial"]), [
    "four tet",
    "burial",
  ]);
});

test("a planted __proto__ is a search like any other, not a booby trap", () => {
  // `Object.hasOwn` in `song-shape.ts` exists because `SOURCE_HOSTS["__proto__"]` answered with
  // the prototype and the parser threw. A `Set` has no such members, which is why one is used
  // for the de-duplication here rather than a plain object.
  const parsed = parseSearches(["__proto__", "constructor", "__proto__", "toString"]);
  assert.deepEqual(parsed, ["__proto__", "constructor", "toString"]);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  // The classic payload is an object, not an array, and stops at the first line.
  assert.deepEqual(parseSearches(JSON.parse('{"__proto__":{"polluted":true}}')), []);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("a hand-planted ten-megabyte query is capped without being walked in full", () => {
  // Ten megabytes of alternating space and letter — the shape that costs the most, because
  // `\s+` has the most to collapse. Measured on this machine: `askedFor` on the whole string
  // takes **2139ms**, and on its first 800 characters **0.1ms**. The strip parses on its first
  // render, synchronously, so that is two seconds of a frozen tab per planted entry and up to
  // twenty of them under one key.
  const huge = " a".repeat(5_000_000);
  const started = performance.now();
  const parsed = parseSearches([huge, "four tet"]);
  const took = performance.now() - started;

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.length, MAX_QUERY);
  assert.equal(parsed[1], "four tet");
  // The slice happens before `askedFor`, so the NFKC pass and the two regexes see 800 characters
  // rather than ten million. Generous on purpose — this is a tripwire for the ordering, not a
  // benchmark. Swapping the two takes it twenty times over this.
  assert.ok(took < 100, `parsing took ${took.toFixed(0)}ms`);
});

test("the record is capped, and the cap is enforced where it is read as well as written", () => {
  const long = Array.from({ length: 200 }, (_, index) => `search ${index}`);
  const parsed = parseSearches(long);
  assert.equal(parsed.length, 20);
  assert.equal(parsed[0], "search 0");

  assert.equal(parseHidden(Array.from({ length: 200 }, (_, i) => `hidden ${i}`)).length, 24);
});

test("one query per entry, however it was spelled", () => {
  assert.deepEqual(parseSearches(["Four Tet", "four tet", "FOUR TET", "burial"]), [
    "Four Tet",
    "burial",
  ]);

  // Everything is cleaned on the way out with the same pass the search box and /api/search use,
  // so a chip can never say something the field itself would refuse. A zero-width space is not
  // whitespace and `trim()` walks straight past it.
  assert.deepEqual(parseSearches(["  four   tet  ", "​​", "﻿"]), ["four tet"]);
});

test("the newest search leads, and drops the half-typed ones it finished", () => {
  // Typing is searching: `search-results.tsx` runs one 300ms after every keystroke, so a single
  // deliberate search arrives here as a ladder. Keeping the ladder would fill twenty slots with
  // one query spelled out a letter at a time.
  let list: string[] = [];
  for (const step of ["n", "ni", "nils", "nils fra", "nils frahm"]) list = withSearch(list, step);
  assert.deepEqual(list, ["nils frahm"]);

  list = withSearch(list, "four tet");
  assert.deepEqual(list, ["four tet", "nils frahm"]);

  // An unrelated query leaves the rest alone, and searching something again moves it to the front
  // rather than repeating it.
  list = withSearch(list, "nils frahm");
  assert.deepEqual(list, ["nils frahm", "four tet"]);
});

test("a search worth nothing is not a search", () => {
  assert.deepEqual(withSearch(["four tet"], "   "), ["four tet"]);
  assert.deepEqual(withSearch(["four tet"], "​"), ["four tet"]);
  assert.deepEqual(withSearch([], "a".repeat(400))[0]?.length, MAX_QUERY);
});

test("twenty searches, and the twenty-first pushes the oldest out", () => {
  let list: string[] = [];
  for (let i = 0; i < 25; i += 1) list = withSearch(list, `query ${String(i).padStart(3, "0")}`);
  assert.equal(list.length, 20);
  assert.equal(list[0], "query 024");
  assert.equal(list.at(-1), "query 005");
});

/**
 * The store half. `local-store.ts` reaches for `window` lazily, so installing one here is enough
 * — and a write that storage refuses must leave what is already stored alone, which is the same
 * rule applied to a list instead of a picture.
 */
function storage(): { backing: Record<string, string>; fail: () => void } {
  const backing: Record<string, string> = {};
  let refuse = false;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
        if (refuse) throw new DOMException("quota", "QuotaExceededError");
        backing[key] = value;
      },
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    backing,
    fail: () => {
      refuse = true;
    },
  };
}

test("a search is remembered, forgotten, and a suggestion put away and brought back", () => {
  const { backing, fail } = storage();
  backing["timbre:searches"] = JSON.stringify(["burial untrue"]);

  rememberSearch("nils frahm");
  assert.deepEqual(JSON.parse(backing["timbre:searches"]!), ["nils frahm", "burial untrue"]);

  forgetSearch("Nils Frahm");
  assert.deepEqual(JSON.parse(backing["timbre:searches"]!), ["burial untrue"]);

  hideSuggestion("Wonderwall");
  hideSuggestion("wonderwall");
  assert.deepEqual(JSON.parse(backing["timbre:suggestions-hidden"]!), ["Wonderwall"]);

  showSuggestionsAgain();
  assert.deepEqual(JSON.parse(backing["timbre:suggestions-hidden"]!), []);

  // Once the quota is gone every later write fails the same way. The list is live in this tab
  // either way, and what storage already holds is left exactly as it was — no retry with a
  // shorter list, because that is the one path that could actually delete entries.
  const before = backing["timbre:searches"];
  fail();
  rememberSearch("four tet");
  assert.equal(backing["timbre:searches"], before);
});
