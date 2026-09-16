import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { GenreMixView } from "./genre-mix-view.tsx";
import type { GenreMix } from "@/lib/rankings.ts";

/**
 * A genre Deezer refused counted nothing, so `mixGenres` dropped it and the chart drew the
 * genres that were left as though they were the week. `FeedProbe.failed` is the one thing that
 * can tell that apart from a genre no charting song belongs to, and until now it stopped at the
 * cache. These are about what it says on the page.
 */

const MIX: GenreMix[] = [
  { genre: "Alternative", total: 14, bands: [1, 3, 4, 6] },
  { genre: "R&B", total: 9, bands: [0, 2, 3, 4] },
];

const markup = (node: React.ReactElement) => renderToStaticMarkup(node);

test("a mix drawn while a genre chart was refused says it is short of genres", () => {
  const html = markup(<GenreMixView mix={MIX} refused />);

  assert.match(html, /wouldn’t answer for some of its genre charts/);
  assert.ok(html.includes("Alternative"), "the genres that did answer are still drawn");
});

test("a whole mix nobody refused carries no apology", () => {
  const html = markup(<GenreMixView mix={MIX} refused={false} />);

  assert.ok(!/wouldn’t answer/.test(html), "a healthy week was apologised for");
  assert.ok(html.includes("Alternative"));
});

test("an empty mix stops hedging: a refusal is named as one", () => {
  const html = markup(<GenreMixView mix={[]} refused />);

  assert.match(html, /wouldn’t answer for its genre charts/);
  assert.match(html, /a gap, not a week in which no genre reached the ranking/);
});

test("an empty mix nobody refused is a week, and says only that", () => {
  const html = markup(<GenreMixView mix={[]} refused={false} />);

  assert.match(html, /No genre chart overlapped the ranking this week/);
  // The old copy offered both readings at once — "either it did not answer or none of its
  // entries reached the top 100" — of a question the probe can now answer.
  assert.ok(!/either it did not answer/.test(html));
  assert.ok(!/wouldn’t answer/.test(html));
});
