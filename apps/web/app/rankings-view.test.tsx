import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { Rankings } from "@/lib/rankings.ts";

/**
 * What the "For you" ranking says when the genre charts behind it were refused.
 *
 * A pick is a song by an artist you have played or a song on one of your genres' charts. The
 * second half is built from the thirty genre charts, and a chart Deezer refused contributes
 * nothing — so a refusal emptied the list and the panel announced "Nothing in this week's top
 * 100 is in Pop, or by anyone you have played". Pop is the largest chart there is; what had
 * happened was that Deezer declined to say, and the sentence turned that into a fact about the
 * week and, by implication, about the listener's taste.
 *
 * The stand-ins below are the modules that need a browser, not the ones under test: the taste
 * book is `localStorage`, and `next/dynamic`, `next/link` and `next/navigation` need a router.
 * `useTaste` is stubbed rather than seeded because the branch only exists for a listener the
 * taste book already knows.
 */
type Resolve = (
  specifier: string,
  context: unknown,
  next: (specifier: string, context: unknown) => unknown,
) => unknown;

const { registerHooks } = createRequire(import.meta.url)("node:module") as {
  registerHooks: (hooks: { resolve: Resolve }) => void;
};

const TASTE =
  "export function useTaste(){return{listening:true," +
  "genres:[{id:132,weight:1,artists:['Someone']}]," +
  "genreOf(){return null},releases:[],artists:new Set()}}";
const DYNAMIC = "export default function dynamic(){return function Stub(){return null}}";
const NAVIGATION = "export function useRouter(){return {push(){}}}";
const LINK =
  "import {createElement} from 'react';" +
  "export default function Link(p){return createElement('a',{href:p.href,className:p.className},p.children)}";

const STUBS: Record<string, string> = {
  "./taste-store": TASTE,
  "next/dynamic": DYNAMIC,
  "next/navigation": NAVIGATION,
  "next/link": LINK,
};

registerHooks({
  resolve(specifier, context, next) {
    const stub = STUBS[specifier];
    return stub
      ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true }
      : next(specifier, context);
  },
});

const { RankingsView } = await import("./rankings-view.tsx");

const RANKINGS: Rankings = {
  charts: ["deezer", "apple"],
  failed: [],
  songs: [
    {
      id: "s1",
      title: "Something charted",
      artists: ["Nobody You Play"],
      album: null,
      durationMs: null,
      isrc: null,
      artworkUrl: null,
      sources: [],
      position: 1,
      charts: ["deezer"],
      positions: { deezer: 1 },
    },
  ] as unknown as Rankings["songs"],
};

function yours(genresRefused: boolean): string {
  return renderToStaticMarkup(
    <RankingsView
      rankings={RANKINGS}
      songGenres={{}}
      genreNames={{ 132: "Pop" }}
      share={[]}
      agree={{ shared: 0, total: 1, only: [] }}
      genresRefused={genresRefused}
      genreMix={null}
      chart={[]}
    />,
  );
}

test("an empty For-you built on refused genre charts says Deezer would not say", () => {
  const html = yours(true);

  assert.match(html, /wouldn’t answer for its genre charts/);
  assert.match(html, /something Timbre was not told/);
  assert.ok(
    !/Nothing in this week&#x27;s top 1 is in Pop/.test(html),
    "a refusal was reported as a fact about the chart",
  );
});

test("an empty For-you nobody refused still says plainly that nothing matched", () => {
  const html = yours(false);

  assert.match(html, /Nothing in this week&#x27;s top 1 is in Pop, or by anyone you have played/);
  assert.ok(!/wouldn’t answer/.test(html), "a complete answer was hedged");
});
