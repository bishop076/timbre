import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import { optionalQueryText, queryFlag, queryText } from "./query-text.ts";

const required = z.object({ q: queryText(200) });
const optional = z.object({ artist: optionalQueryText(200) });

test("a blank query is refused, not searched for", () => {
  for (const q of ["   ", "", "\t\n ", undefined]) {
    assert.equal(required.safeParse({ q }).success, false);
  }
});

test("surrounding space is trimmed off what is sent onward", () => {
  assert.equal(required.parse({ q: "  daft punk  " }).q, "daft punk");
});

test("a blank optional parameter is absent rather than an error", () => {
  assert.equal(optional.parse({ artist: "  " }).artist, undefined);
  assert.equal(optional.parse({}).artist, undefined);
});

test("the length ceiling still applies, after trimming", () => {
  assert.equal(optional.safeParse({ artist: `  ${"a".repeat(200)}  ` }).success, true);
  assert.equal(optional.safeParse({ artist: "a".repeat(201) }).success, false);
});

test("a flag is only on when it says so", () => {
  for (const value of ["1", "true"]) assert.equal(queryFlag.parse(value), true);
  for (const value of ["0", "false", undefined]) assert.equal(queryFlag.parse(value), false);
  assert.equal(queryFlag.safeParse("yes").success, false);
});

test("a query of nothing but invisible characters is blank, not a search", () => {
  // Each of these is what a paste leaves behind: a soft hyphen off a hyphenated web page, a
  // zero-width space off a lyrics site, a left-to-right mark off an Arabic or Hebrew title.
  // None is whitespace, so none of them is trimmed, and `/api/search?q=%C2%AD` really did
  // reach all six providers.
  for (const q of ["­", "​", "‎", "⁠", "​ ​"]) {
    assert.equal(required.safeParse({ q }).success, false, JSON.stringify(q));
  }
});

test("invisible characters inside a query are dropped rather than searched for", () => {
  assert.equal(required.parse({ q: "daft​punk" }).q, "daftpunk");
  assert.equal(required.parse({ q: "sigur rós" }).q, "sigur rós");
});

test("interior whitespace collapses, so one question is one cache entry", () => {
  // `/api/search` keys its response cache on this exact string.
  assert.equal(required.parse({ q: "daft   punk" }).q, "daft punk");
  assert.equal(required.parse({ q: "daft\tpunk\npunk" }).q, "daft punk punk");
});

test("a name is the same name however it was composed", () => {
  // "Björk" as Deezer sends it (one code point) and as macOS pastes it (o + combining
  // diaeresis) reached the providers as two different queries.
  assert.equal(required.parse({ q: "Björk" }).q, required.parse({ q: "Björk" }).q);
  // Full-width Latin is what a Japanese IME types without being asked for half-width.
  assert.equal(required.parse({ q: "Ｄａｆｔ Ｐｕｎｋ" }).q, "Daft Punk");
});

test("an optional parameter is cleaned the same way", () => {
  assert.equal(optional.parse({ artist: "​" }).artist, undefined);
  assert.equal(optional.parse({ artist: "the  beatles " }).artist, "the beatles");
});
