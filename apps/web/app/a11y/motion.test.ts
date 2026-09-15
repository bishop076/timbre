import assert from "node:assert/strict";
import { test } from "node:test";

import { prefersReducedMotion, scrollBehavior } from "./motion";

/** A `window` with just enough `matchMedia` on it to answer the one query this module asks. */
function withMatchMedia<T>(matches: boolean | null, body: () => T): T {
  const had = "window" in globalThis;
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window =
    matches === null
      ? {}
      : {
          matchMedia: (query: string) => ({ matches: matches && /reduce/.test(query) }),
        };
  try {
    return body();
  } finally {
    if (had) (globalThis as { window?: unknown }).window = previous;
    else delete (globalThis as { window?: unknown }).window;
  }
}

test("a reader who asked for less movement gets an instant scroll", () => {
  withMatchMedia(true, () => {
    assert.equal(prefersReducedMotion(), true);
    assert.equal(scrollBehavior(), "auto");
  });
});

test("everyone else still gets the smooth one", () => {
  withMatchMedia(false, () => {
    assert.equal(prefersReducedMotion(), false);
    assert.equal(scrollBehavior(), "smooth");
  });
});

test("no window at all is the server, and the server does not scroll", () => {
  // Rendering on the server must not claim reduced motion: the client's first answer is `false`
  // too, and disagreeing would mean a still frame that starts moving at hydration.
  const had = "window" in globalThis;
  const previous = (globalThis as { window?: unknown }).window;
  delete (globalThis as { window?: unknown }).window;
  try {
    assert.equal(prefersReducedMotion(), false);
    assert.equal(scrollBehavior(), "smooth");
  } finally {
    if (had) (globalThis as { window?: unknown }).window = previous;
  }
});

test("a browser too old for matchMedia is not a reason to refuse to scroll", () => {
  withMatchMedia(null, () => {
    assert.equal(prefersReducedMotion(), false);
    assert.equal(scrollBehavior(), "smooth");
  });
});
