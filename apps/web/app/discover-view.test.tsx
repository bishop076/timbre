import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { Discover } from "@/lib/discover.ts";
import type { Radio } from "@/lib/radios.ts";

/**
 * What Explore looks like when Deezer will not answer.
 *
 * `/genre` and `/radio/genres` are fixed catalogues, and `deezerList` forgives a refusal into
 * `[]`, so a rate-limited read reaches this component as a catalogue with nothing in it. Every
 * section built from one used to remove itself — both pill rows and, through its fallback,
 * Featured — leaving a page title above a gap. These are the same reads the `/explore` route
 * already refuses to cache; this is the half a reader can see.
 *
 * `next/link` and `next/navigation` are mapped to stand-ins for the same reason
 * `not-found-status.test.tsx` maps `next/navigation`: Node's resolver cannot load either, and
 * neither one decides anything these tests are about.
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
const NAVIGATION = "export function useRouter(){return {push(){}}}";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/link") {
      return { url: `data:text/javascript,${encodeURIComponent(LINK)}`, shortCircuit: true };
    }
    if (specifier === "next/navigation") {
      return { url: `data:text/javascript,${encodeURIComponent(NAVIGATION)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { DiscoverView } = await import("./discover-view.tsx");

const GENRES = [
  { id: 132, name: "Pop", imageUrl: null },
  { id: 152, name: "Rock", imageUrl: null },
];

const RADIOS: Radio[] = [
  { id: 1, title: "Deep House", genre: "Dance", genreId: 113, imageUrl: null },
];

function discover(over: Partial<Discover> = {}): Discover {
  return { genres: GENRES, tracks: [], albums: [], artists: [], playlists: [], ...over };
}

function explore(initial: Discover, radios: Radio[]): string {
  return renderToStaticMarkup(
    <DiscoverView initial={initial} radios={radios} rotation={0} rankings={null} />,
  );
}

test("a refused genre catalogue is said out loud, not left as a missing row", () => {
  const html = explore(discover({ genres: [] }), RADIOS);

  assert.match(html, /Deezer wouldn’t answer for genres just now/);
  assert.match(html, /that row is missing rather than empty/);
  assert.ok(html.includes("Stations"), "the row that did answer is still drawn");
});

test("a refused station catalogue is said too, and the genres it did answer for stay", () => {
  const html = explore(discover(), []);

  assert.match(html, /Deezer wouldn’t answer for stations just now/);
  assert.ok(html.includes("Pop"), "the genre pills were dropped with the stations");
  assert.ok(!html.includes("Stations"), "an empty station row should not draw its header");
});

test("both refused at once is one notice naming both, never two boxes", () => {
  const html = explore(discover({ genres: [] }), []);

  assert.match(html, /Deezer wouldn’t answer for genres and stations just now/);
  assert.match(html, /those rows are missing rather than empty/);
  assert.equal(
    html.match(/Deezer wouldn’t answer/g)?.length,
    1,
    "a short window cannot spend 300px saying the same thing twice",
  );
});

test("Deezer answering normally says nothing at all", () => {
  const html = explore(discover(), RADIOS);

  assert.ok(!/wouldn’t answer/.test(html), "a healthy Explore apologised for nothing");
  assert.ok(html.includes("Pop") && html.includes("Stations"));
});

test("a genre list that is only the overall chart still counts as answered", () => {
  // `/genre` always includes id 0 ("All"), which the pills filter out. An answer holding just
  // that is a real answer, and treating it as a refusal would apologise on a working page.
  const html = explore(discover({ genres: [{ id: 0, name: "All", imageUrl: null }] }), RADIOS);

  assert.ok(!/wouldn’t answer/.test(html));
});
