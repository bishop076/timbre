import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ROW_BADGES } from "./source-badges.tsx";

/**
 * Eleven controls in this app are drawn at `opacity: 0` and brought back by `group-hover`. A
 * touch screen never hovers, so on a phone they never appeared — and because `opacity: 0` does
 * not stop a tap, the corner of every tile also held a live button nothing said was there.
 *
 * The fix is one variant, `touch:` = `@media (hover: none)`, applied at each site. What this
 * suite guards is the rule rather than any one site: a class string in these files that reveals
 * something on hover has to say what a device with no hover should do. Reading the source is the
 * only way to check that — there is no DOM here, and the interesting half of the decision is a
 * media query no `renderToStaticMarkup` will evaluate. `layout.test.ts` reads its own source for
 * the same reason.
 */
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const SITES = [
  "search-suggestions.tsx",
  "song-card.tsx",
  "song-row.tsx",
  "tile-cards.tsx",
  "source-badges.tsx",
  "playlists/library-view.tsx",
  "playlists/playlist-view.tsx",
  "liked/liked-view.tsx",
];

/**
 * The two sites that stay hover-only, and why. Neither is a control: both are pictures of what a
 * tap would already do, `aria-hidden` or `pointer-events-none`, laid over a target that fills the
 * whole cover. Drawn at rest they cost a 40px disc on every 150px tile and a dark scrim on every
 * thumbnail in every list, and buy nothing you could not do by tapping the artwork. Held here as
 * exact strings so that changing one is a decision somebody has to come back and make again.
 */
const HOVER_ONLY = [
  // song-card.tsx — the play glyph on a tile's cover.
  "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100",
  // song-row.tsx — the scrim over a row's thumbnail.
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
];

/** Every quoted string in a source, which is where a class list lives and a comment does not. */
function quoted(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

for (const name of SITES) {
  test(`${name} tells a screen with no hover what to draw`, () => {
    const revealing = quoted(read(name)).filter((value) => value.includes("group-hover:opacity-100"));

    for (const value of revealing) {
      if (HOVER_ONLY.includes(value)) continue;
      assert.ok(
        value.includes("touch:opacity-100"),
        `a control in ${name} appears on hover and nowhere else:\n  ${value}`,
      );
    }
  });
}

test("the touch variant asks about the primary input, not any input at all", () => {
  const css = read("globals.css");

  assert.match(css, /@custom-variant touch \(@media \(hover: none\)\);/);
  // `any-hover`/`any-pointer` match a touchscreen laptop with a trackpad plugged in — a machine
  // that hovers perfectly well. Using them here would push the touch layout onto the one screen
  // that never needed it, which is the failure this whole change is trying not to cause.
  assert.ok(
    !/@custom-variant touch \([^)]*any-(hover|pointer)/.test(css),
    "the touch variant fires on a machine that can hover",
  );
});

test("a row's source badges are one class list, not three copies of one", () => {
  assert.ok(ROW_BADGES.includes("touch:opacity-100"));
  // Two of the copies had drifted: `liked` and a playlist wrote out their own badge classes and
  // left `focus-within:` off, so tabbing to a badge revealed it on /album and /rankings and not
  // on /liked. They import the constant now.
  assert.ok(ROW_BADGES.includes("focus-within:opacity-100"));

  for (const name of ["liked/liked-view.tsx", "playlists/playlist-view.tsx"]) {
    assert.ok(
      !read(name).includes("group-hover:opacity-100 @xl:flex"),
      `${name} still carries its own copy of the badge classes`,
    );
  }
});

test("the two smallest controls in the app are 24px to a finger", () => {
  const source = read("source-badges.tsx");

  // WCAG 2.5.8 measures what activates the control, so the area is grown with an out-of-flow
  // `::before` and the picture does not move. The glyph is `size-2.5` — 10px — and takes 7px
  // above and below and 4px left plus 10px right, which is 24 each way; the source name renders
  // 16.5px tall and takes 4px above and below, which is 24.5. Both are hit-tested in the browser
  // run; this is the tripwire for the arithmetic those numbers depend on.
  assert.match(source, /<ExternalIcon className="size-2\.5" \/>/);
  assert.match(source, /before:absolute before:inset-x-0 before:-inset-y-1 before:content-\[''\]/);
  assert.match(
    source,
    /before:absolute before:-inset-y-\[7px\] before:-left-1 before:-right-2\.5 before:content-\[''\]/,
  );
});

/**
 * The twelfth. The now-playing panel's hide control was removed in `4d80344` because it and the
 * player bar's toggle were two permanent buttons for one job; it is back as a hover-revealed one,
 * which makes the corner empty at rest again and the button discoverable with a pointer. That
 * trade only holds if "hover" is the mouse's answer and not everybody's — a phone has no hover at
 * all, and the panel's only other way out is a drag on a handle that does not exist below `xl`.
 *
 * Named group, so the sweep above does not see it: `group-hover/panel:` is not
 * `group-hover:`. This asserts the same rule at the one site that spells it differently.
 */
test("the now-playing panel's hide control is reachable without a pointer", () => {
  const revealing = quoted(read("player/now-playing.tsx")).filter((value) =>
    value.includes("group-hover/panel:opacity-100"),
  );

  assert.equal(revealing.length, 1, "the panel reveals more than the one control on hover");

  for (const value of revealing) {
    assert.ok(value.includes("touch:opacity-100"), `hover-only on a screen with no hover:\n  ${value}`);
    assert.ok(
      value.includes("focus-visible:opacity-100"),
      `hover-only from a keyboard:\n  ${value}`,
    );
  }
});
