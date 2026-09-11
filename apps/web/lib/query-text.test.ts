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
