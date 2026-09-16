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

/**
 * The source with its prose taken out — block comments and whole-line `//` comments.
 *
 * The comments around the frame quote the old class names on purpose, and a sweep that cannot
 * tell a class from a sentence would forbid explaining them. Whole lines only, so the `//` in a
 * URL inside a template literal survives.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("the docked media sits in one frame, not a height per source", () => {
  // Six sources, five hard-coded heights: 166 for SoundCloud, 200 for YouTube, Audius and
  // Spotify, 280 for Mixcloud, 300 for a Deezer embed. The panel's whole top third resized
  // whenever the ladder resolved the next track somewhere else, and everything under it — the
  // title, the queue, Credits — moved with it.
  const heights = [...code(source).matchAll(/(?:min-)?h-\[\d+px\]/g)].map((match) => match[0]);
  assert.deepEqual(heights, [], `the media box still carries a height per source: ${heights}`);

  // What survives instead is a floor, and it is the same floor whatever is playing: YouTube's
  // iframe API writes `min-height: 200px` onto the element it mounts into, and a 16:9 frame is
  // only that tall once it is 356px wide — so at every ordinary panel width the player stood
  // proud of the box and `overflow-hidden` took the difference off the bottom of the video, 19px
  // of it at the default. SoundCloud's fixed 166px widget sits under the same floor.
  //
  // The `2 * --edge` is the frame's own border: the box is `border-box`, so a flat 200 leaves the
  // player 196 and still cuts 4px. Losing either half of this sum is losing a video's bottom
  // edge, which is why it is pinned here rather than left to whoever tidies the class list next.
  assert.ok(
    source.includes("min-h-[calc(200px+2*var(--edge))]"),
    "the frame's floor no longer clears YouTube's own minimum",
  );

  // One ratio for all of them, and the gutter that makes it a frame inside the panel rather than
  // a band across it. Without the padding the box bleeds to both edges again and there is no
  // frame left to speak of.
  assert.ok(
    source.includes(
      'const frame = expanded\n    ? "relative h-full w-full"\n    : "slab-sm relative aspect-video w-full min-h-[calc(200px+2*var(--edge))] overflow-hidden rounded-[var(--r-md)] bg-black";',
    ),
    "the docked frame is no longer one box with one ratio",
  );
  // The gutter, and specifically the panel's own: `p-3.5` is what the heading and the queue are
  // already inset by, so the picture's left edge lines up with the title's rather than reaching
  // 6px further into the margin than anything else in the panel.
  assert.ok(
    source.includes('    : "shrink-0 p-3.5";'),
    "the frame has lost the panel's gutter around it",
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
