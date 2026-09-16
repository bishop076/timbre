import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

/**
 * The For-you shelves when there is no genre catalogue to draw them from.
 *
 * Picks come from `/genre`, and `deezerList` forgives a refusal into `[]`. With no picks the
 * component fell through to its loading state — `SHELVES` skeleton shelves — and nothing would
 * ever replace them, because the list they would be built from is the one that was refused. A
 * reader on a Deezer outage got a screen of shimmer that was, in full, a promise the page knew
 * it could not keep. An earlier fix took that same lie out of the shelf below without noticing it was
 * also worn one level up, as a promise rather than a gap.
 *
 * `next/link` is mapped for the reason `not-found-status.test.tsx` maps `next/navigation`:
 * Node's resolver cannot load it, and it decides nothing here.
 */
type Resolve = (
  specifier: string,
  context: unknown,
  next: (specifier: string, context: unknown) => unknown,
) => unknown;

const { registerHooks } = createRequire(import.meta.url)("node:module") as {
  registerHooks: (hooks: { resolve: Resolve }) => void;
};

const LINK =
  "import {createElement} from 'react';" +
  "export default function Link(p){return createElement('a',{href:p.href,className:p.className},p.children)}";

registerHooks({
  resolve(specifier, context, next) {
    return specifier === "next/link"
      ? { url: `data:text/javascript,${encodeURIComponent(LINK)}`, shortCircuit: true }
      : next(specifier, context);
  },
});

const { ExploreForYou } = await import("./explore-for-you.tsx");

const GENRES = [
  { id: 132, name: "Pop", imageUrl: null },
  { id: 152, name: "Rock", imageUrl: null },
];

const skeletons = (html: string) => html.match(/animate-pulse/g)?.length ?? 0;

test("a genre catalogue that answered is a promise the shelves can keep", () => {
  const html = renderToStaticMarkup(<ExploreForYou genres={GENRES} />);

  assert.ok(skeletons(html) > 0, "the shelves should stand at their final height while loading");
});

test("a refused genre catalogue leaves no skeleton shimmering for the rest of the visit", () => {
  const html = renderToStaticMarkup(<ExploreForYou genres={[]} />);

  assert.equal(skeletons(html), 0, "a shelf that can never fill was still promising to");
  assert.ok(!html.includes("For you"), "an empty catalogue drew a heading with nothing under it");
});
