import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import { optionalQueryText, queryFlag, queryText } from "./query-text.ts";

const required = z.object({ q: queryText(200) });
const optional = z.object({ artist: optionalQueryText(200) });

test("a blank query is refused, not searched for", () => {
  assert.equal(required.safeParse({ q: "   " }).success, false);
  assert.equal(required.safeParse({ q: "" }).success, false);
  assert.equal(required.safeParse({ q: "\t\n " }).success, false);
  assert.equal(required.safeParse({ q: undefined }).success, false);
});

test("surrounding space is trimmed off what is sent onward", () => {
  const parsed = required.parse({ q: "  daft punk  " });
  assert.equal(parsed.q, "daft punk");
});

test("a blank optional parameter is absent rather than an error", () => {
  const parsed = optional.parse({ artist: "  " });
  assert.equal(parsed.artist, undefined);
  assert.equal(optional.parse({}).artist, undefined);
});

test("the length ceiling still applies, after trimming", () => {
  assert.equal(optional.safeParse({ artist: `  ${"a".repeat(200)}  ` }).success, true);
  assert.equal(optional.safeParse({ artist: "a".repeat(201) }).success, false);
});

test("a flag is only on when it says so", () => {
  assert.equal(queryFlag.parse("1"), true);
  assert.equal(queryFlag.parse("true"), true);
  assert.equal(queryFlag.parse("0"), false);
  assert.equal(queryFlag.parse("false"), false);
  assert.equal(queryFlag.parse(undefined), false);
  assert.equal(queryFlag.safeParse("yes").success, false);
});
