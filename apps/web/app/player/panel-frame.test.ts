import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The panel's media box, read from its source.
 *
 * There is no DOM in this suite and the interesting half of this decision is a ratio the browser
 * resolves, so what is guarded here is the shape of the rule rather than a rendered pixel — the
 * same reason `touch-reveal.test.ts` and `layout.test.ts` read their own sources. The pixels are
 * checked in the production browser run; this is the tripwire that stops the old arrangement
 * coming back by accident.
 *
 * Line endings are not part of any of these comparisons.
 */
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8").split("\r\n").join("\n");

const source = read("./now-playing.tsx");

test("the docked media sits in one frame, not a height per source", () => {
  // Six sources, five hard-coded heights: 166 for SoundCloud, 200 for YouTube, Audius and
  // Spotify, 280 for Mixcloud, 300 for a Deezer embed. The panel's whole top third resized
  // whenever the ladder resolved the next track somewhere else, and everything under it — the
  // title, the queue, Credits — moved with it.
  //
  // One pixel height survives and it is not one of those: `min-h-[166px]` is a floor on the
  // frame, the same whatever is playing. It is here because SoundCloud's iframe is a fixed 166px
  // that no box can talk out of it, so a 16:9 frame narrower than ~295px cuts the widget — 20px
  // of it at the panel's own minimum width.
  const heights = [...source.matchAll(/(?:min-)?h-\[\d+px\]/g)].map((match) => match[0]);
  assert.deepEqual(
    heights,
    ["min-h-[166px]"],
    `the media box carries a height it should not: ${heights}`,
  );

  // One ratio for all of them, and the gutter that makes it a frame inside the panel rather than
  // a band across it. Without the padding the box bleeds to both edges again and there is no
  // frame left to speak of.
  assert.ok(
    source.includes(
      'const frame = expanded\n    ? "relative h-full w-full"\n    : "slab-sm relative aspect-video w-full min-h-[166px] overflow-hidden rounded-[var(--r-md)] bg-black";',
    ),
    "the docked frame is no longer one box with one ratio",
  );
  assert.ok(
    source.includes('    : "shrink-0 p-2";'),
    "the frame has lost the panel's padding around it",
  );

  // Every player is told the same thing, because the frame is what decides the size now.
  // `justify-center` is the one concession: SoundCloud's widget is a fixed 166px tall and would
  // otherwise sit on the frame's top edge with a band of black under it.
  assert.ok(source.includes('const size = "h-full w-full justify-center";'));
});

test("expanding is animated, and not for a reader who asked for less motion", () => {
  // The gate is in JS on purpose. globals.css collapses every duration to 0.01ms under
  // `prefers-reduced-motion`, which would still run a scale from 0.94 — in a single frame, which
  // is a flash. With the class absent there is nothing left to shorten.
  assert.match(source, /const reducedMotion = useReducedMotion\(\);/);
  assert.match(
    source,
    /const arrival = reducedMotion \? "" : expanded \? "into-theater" : "into-dock";/,
  );

  const css = read("../globals.css");
  for (const name of ["into-theater", "into-dock"]) {
    assert.ok(css.includes(`@keyframes ${name} {`), `${name} has no keyframes`);
    assert.ok(
      css.includes(`.${name} {\n  animation: ${name} var(--expand-ms) var(--ease);\n}`),
      `${name} does not run for --expand-ms`,
    );
  }

  // Two names rather than one animation with a direction, because swapping `animation-name` is
  // the only thing that restarts an animation on an element that is never remounted — and it must
  // never be remounted, because every embed player lives inside it.
  assert.notEqual(
    css.indexOf("@keyframes into-theater"),
    css.indexOf("@keyframes into-dock"),
    "the two directions collapsed into one animation name",
  );

  // No fill mode: a transform that outlives its animation leaves the card a containing block for
  // every fixed-position descendant, for good.
  assert.ok(!css.includes("animation: into-theater var(--expand-ms) var(--ease) both"));
});
