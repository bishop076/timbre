import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Issue #22: five defects at 1536x690, and four of them come down to a box eating whatever sat
 * at its edge — a focus ring shaved flat by `overflow: hidden`, a shut panel that could not get
 * to zero width, a heart pushed to the far end of a column it was supposed to sit inside.
 *
 * There is nothing here to import and call. Every one of these components needs the whole player
 * context to render, and what went wrong was never the logic: it was which Tailwind utility won.
 * So this reads the source the way `layout.test.ts` reads the boot script, and pins the shape
 * that keeps the pixel right. A rename moves the test; a quiet edit fails it.
 */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the shut now-playing panel carries no padding, so `width: 0` really is nothing", () => {
  const src = source("./player/now-playing.tsx");

  const shut = /"(pointer-events-none translate-y-3[^"]*)"/.exec(src)?.[1];
  assert.ok(shut, "the shut-panel class string moved; this test has to move with it");
  // `xl:p-0` and `xl:p-2` are the same property at the same specificity in the same media query,
  // so the sheet's order decides, and Tailwind emits `p-0` first. Padding here loses, the shut
  // panel keeps 8px, and `box-sizing: border-box` paints it as a sliver at the window's edge.
  assert.doesNotMatch(shut, /\bxl:p/, "a padding utility on the shut panel loses to the open one");
  assert.match(shut, /\bxl:w-0\b/);

  const open = /"(translate-y-0 opacity-100[^"]*)"/.exec(src)?.[1];
  assert.ok(open, "the open-panel class string moved; this test has to move with it");
  assert.match(open, /\bxl:p-2 xl:pl-0\b/, "the gutter padding belongs to the open state now");
});

test("a tile's artist link truncates itself, so no paragraph clips its focus ring", () => {
  const src = source("./song-card.tsx");

  const pair = /<p className="([^"]*)">\s*<ArtistLink[^>]*className="([^"]*)"/.exec(src);
  assert.ok(pair, "the tile subtitle moved; this test has to move with it");
  const [, paragraph, link] = pair;

  // `truncate` is `overflow: hidden`, and the ring is a box-shadow 4px outside the border box.
  // Whichever box truncates is the box that clips, so it must not be an ancestor of the link.
  assert.doesNotMatch(paragraph, /\btruncate\b/, "this paragraph would clip the link's ring flat");
  assert.match(link, /\btruncate\b/);
  assert.match(link, /\bmax-w-full\b/, "without a cap there is nothing for `truncate` to bite on");
  assert.match(link, /\balign-top\b/, "an inline-block on the baseline makes the line taller");
});

test("the rail's scrolling list keeps room above its first row for a ring", () => {
  const src = source("./shell/sidebar.tsx");

  const scroller = /className="(edge-fade scroller[^"]*)"/.exec(src)?.[1];
  assert.ok(scroller, "the rail's scroller moved; this test has to move with it");
  // A scroller clips at its padding box. With no padding-top the first row is flush with that
  // edge and the top of its ring is shaved off square.
  assert.match(scroller, /\bpt-1\b/, "the first row of the rail loses the top of its focus ring");
});

test("the library drawer is gone rather than merely unreachable", () => {
  const src = source("./shell/sidebar.tsx");

  // It was 55 lines plus a `RailStyle` of its own, reached by an `onExpand` nothing ever called.
  // Every way into the library navigates to `/library` now, which is the decision the comment
  // above the icon-width link records: a library is a place.
  assert.doesNotMatch(src, /LibraryDrawer|LABELLED|onExpand/);
  assert.doesNotMatch(src, /<dialog/, "the rail has no top-layer panel of its own");
});

test("the bar's title group is sized to the title, so the heart stays next to it", () => {
  const src = source("./shell/player-bar.tsx");

  // This is a grid cell. Stretched, the group filled its whole 1fr share and `meta`'s `flex-1`
  // pushed the heart to the far end — 416px from the end of the title, 16px from shuffle.
  // The one that also holds the heart — the mobile bar stacks the same two pieces above a Scrub.
  const group = /<div className="([^"]*)">\s*\{artwork\}\s*\{meta\}\s*\{current \?/.exec(src)?.[1];
  assert.ok(group, "the bar's title group moved; this test has to move with it");
  assert.match(group, /\bw-fit\b/, "a stretched group puts the heart beside shuffle, not the title");
});
