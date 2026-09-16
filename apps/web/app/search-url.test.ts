import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_QUERY, askedFor, readSearchQuery, searchPath } from "./search-url.ts";

test("a query becomes a shareable path", () => {
  assert.equal(searchPath("Burial"), "/search?q=Burial");
  assert.equal(searchPath("Tame Impala"), "/search?q=Tame%20Impala");
  assert.equal(searchPath("  Aphex Twin  "), "/search?q=Aphex%20Twin");
});

test("an empty search is the bare path, not an empty parameter", () => {
  // Clearing the box should leave /search, not /search?q= — the latter reloads to nothing
  // while looking like it holds something.
  assert.equal(searchPath(""), "/search");
  assert.equal(searchPath("   "), "/search");
});

test("everything that would break a URL is encoded", () => {
  assert.equal(searchPath("rock & roll"), "/search?q=rock%20%26%20roll");
  assert.equal(searchPath("a?b#c"), "/search?q=a%3Fb%23c");
  assert.equal(searchPath("100%"), "/search?q=100%25");
  assert.equal(searchPath("téléphone"), "/search?q=t%C3%A9l%C3%A9phone");
});

test("a path survives the round trip back to a query", () => {
  for (const query of ["Burial", "rock & roll", "a?b#c", "100%", "téléphone", "日本"]) {
    const path = searchPath(query);
    assert.equal(readSearchQuery(path.slice(path.indexOf("?"))), query, query);
  }
});

test("reading a query tolerates whatever is in the address bar", () => {
  assert.equal(readSearchQuery("?q=Burial"), "Burial");
  assert.equal(readSearchQuery("?q=Burial&extra=1"), "Burial");
  assert.equal(readSearchQuery("?other=1"), "");
  assert.equal(readSearchQuery("?q="), "");
  assert.equal(readSearchQuery(""), "");
  assert.equal(readSearchQuery("?q=%E2%9C%93"), "✓");
  // A half-written escape is left literal rather than throwing, and a literal % is a
  // perfectly good thing to search for.
  assert.equal(readSearchQuery("?q=%"), "%");
});

test("both ends cap at what /api/search would accept", () => {
  const long = "x".repeat(MAX_QUERY + 50);
  assert.equal(readSearchQuery(`?q=${long}`).length, MAX_QUERY);
  assert.equal(searchPath(long), `/search?q=${"x".repeat(MAX_QUERY)}`);
});

test("what is invisible in the box is not a query", () => {
  // `trim()` walks straight past a format character, so a pasted soft hyphen or zero-width
  // space used to reach /api/search, come back 400, and be reported as "Search failed (400)".
  // It is an empty box, and an empty box is the empty state.
  assert.equal(askedFor("­"), "");
  assert.equal(askedFor("​​​"), "");
  assert.equal(askedFor("‎ daft​punk ‏"), "daftpunk");
  assert.equal(searchPath("​"), "/search");
  assert.equal(readSearchQuery("?q=%E2%80%8B"), "");
});

test("the same question is not two different ones", () => {
  // /api/search keys its two-minute cache on the text it parsed, so the page has to ask in
  // the same spelling: interior runs of space collapse and an accent arrives composed.
  assert.equal(askedFor("daft   punk"), "daft punk");
  assert.equal(askedFor("daft punk"), "daft punk");
  assert.equal(askedFor("Björk"), "Björk");
  assert.equal(askedFor("Ｆｌｕｍｅ"), "Flume");
});

test("a long paste is searched, not refused", () => {
  // The box sent whatever was in it while the address bar sent 200, so a paste over the cap
  // came back "Search failed (400)" from a route that had told the URL what it accepts.
  const long = `${"x".repeat(MAX_QUERY)}yyyy`;
  assert.equal(askedFor(long).length, MAX_QUERY);
  assert.equal(askedFor(long), "x".repeat(MAX_QUERY));
});
