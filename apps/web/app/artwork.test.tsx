import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Artwork } from "./artwork.tsx";

// The first component rendered by this suite. Until `test-hooks.mjs` learned to transpile JSX
// the test glob could not match a `.tsx` at all — Node refuses one outright — so every
// assertion about what this app actually draws lived in a browser on somebody's machine.
//
// `renderToStaticMarkup` is the deliberate choice over a DOM: it needs no `document`, so the
// suite stays a plain `node --test` with no jsdom in the lockfile. It runs a client component's
// first render, which is where the interesting decision below is made.

const LISTED = "https://i.ytimg.com/vi/H5v3kku4y6Q/hqdefault.jpg";

function markup(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

test("an allowlisted cover is drawn through the proxy, never straight from the host", () => {
  const html = markup(<Artwork src={LISTED} />);
  assert.match(html, /<img[^>]+src="\/api\/art\?u=/);
  assert.ok(!html.includes("i.ytimg.com/vi"), "the raw host leaked into the markup");
});

test("an unlisted host draws the placeholder rather than an off-site image", () => {
  // The allowlist-refusal shape: `proxied` returns null and the component has to fall back rather than emit
  // an <img> the browser would fetch from a host nobody vetted.
  const html = markup(<Artwork src="https://evil.example/cover.jpg" />);
  assert.ok(!html.includes("<img"), "an unvetted host was handed to the browser");
  assert.ok(!html.includes("evil.example"));
  assert.match(html, /<svg/, "the note placeholder should be drawn instead");
});

test("no source at all is the placeholder too", () => {
  for (const src of [null, undefined, ""]) {
    const html = markup(<Artwork src={src} />);
    assert.ok(!html.includes("<img"), `${JSON.stringify(src)} produced an image`);
  }
});

test("eager asks the browser for the cover now, and is off by default", () => {
  assert.match(markup(<Artwork src={LISTED} eager />), /loading="eager"[^>]*decoding="sync"/);
  assert.match(markup(<Artwork src={LISTED} />), /loading="lazy"[^>]*decoding="async"/);
});

test("the class names a caller passes reach the element it draws", () => {
  const html = markup(<Artwork src={LISTED} className="size-12" surfaceClassName="bg-red" />);
  assert.ok(html.includes("size-12"));
  assert.ok(html.includes("bg-red"));
});
