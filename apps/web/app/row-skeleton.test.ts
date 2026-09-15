import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SCALE, type RowSize } from "./row-scale.ts";
import { RowSkeletons } from "./row-skeleton.tsx";

// `createElement` rather than JSX because this is a `.ts`: the suite's own rule is that a test
// is plain TypeScript, and one element is not worth a second file extension.
const markup = (size?: RowSize) => renderToStaticMarkup(createElement(RowSkeletons, { size }));

/**
 * A row's height is its thumbnail plus the vertical padding around it, both of which live in
 * `SCALE`. The skeleton had its own `size-14` and `py-3` — 80px against a real 64px at `sm` and
 * 72.8px at `md` — so every list shifted upwards as it finished loading.
 */
for (const size of ["sm", "md", "lg"] as const) {
  test(`a ${size} skeleton reserves what a ${size} row will take`, () => {
    const html = markup(size);

    for (const token of SCALE[size].thumb.split(" ")) {
      assert.ok(html.includes(token), `the thumbnail is missing ${token}`);
    }
    for (const token of SCALE[size].play.split(" ")) {
      assert.ok(html.includes(token), `the padding is missing ${token}`);
    }
  });
}

test("the default is the size search draws, and the rows are hidden from readers", () => {
  const html = markup();
  assert.equal(html, markup("md"));
  assert.match(html, /aria-hidden/);
  assert.equal(html.split("<li").length - 1, 6);
});

test("no size draws another size's row", () => {
  // `sm` is the one with a distinct thumbnail; if the default ever silently became it, the
  // artist page would look right and search would not.
  assert.ok(!markup("md").includes("sm:size-11"));
  assert.ok(markup("sm").includes("sm:size-11"));
});
