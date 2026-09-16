"use client";

import { ArtistLink } from "./artist-link";
import { Artwork } from "./artwork";
import { sized } from "./artwork-url";
import { CheckIcon, PlusIcon } from "./icons";
import { usePlayerControls } from "./player/player-context";
import { sameTrack } from "./player/song-match";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { PlayGlyph } from "./tile-cards";
import type { Song } from "./types";

/**
 * A tile's width is a fraction of the row, not a fixed number.
 *
 * Two things were wrong with `w-[8rem] sm:w-[11.5rem]`. It asked the *viewport*, which knows
 * nothing about the icon rail or a dragged now-playing panel, so a 1280px window with the panel
 * open kept 184px tiles in a ~590px column. And a fixed width against a track of arbitrary size
 * slices the last tile down the middle at very nearly every width — six covers with the sixth
 * cut in half. The edge fade was then honestly reporting that there is more, which from the
 * outside reads as the app fading things for no reason on a wide screen: "i dont want any
 * fading when its full view. just show all, only fade when theres the right sidebar."
 *
 * `100%` inside a flex item resolves against the scroller's content box, so `(100% - gaps) / n`
 * divides the track exactly and the row always ends on a tile boundary. The gap in the sum is
 * the shelf's, which is a constant `gap-2` precisely so these two numbers cannot drift apart.
 *
 * Container queries, not viewport ones: the point is that the row re-divides while the panel
 * edge is being dragged, and a drag changes the column without touching the window.
 *
 * Going from n to n+1 costs a third of the tile width at the low end, so the bands are wide and
 * placed where a tile would otherwise get absurd; across all of them a tile stays between about
 * 130 and 200px. At 1152, the widest the content column goes, that is six tiles of ~175. At the
 * 560px `MAIN_MIN` a greedy pane leaves, three of ~180.
 */
/*
 * Written out as literal class strings, never assembled. Tailwind scans source TEXT for class
 * names — a class built from a template literal or a variable produces no CSS at all, silently,
 * and the tile falls back to its intrinsic width. Same shape of trap as a bundler that only
 * traces a static `new URL`.
 *
 * No spaces inside the brackets, either: Tailwind's arbitrary-value syntax ends at whitespace,
 * so `calc(100% - 1rem)` has to be written `calc(100%-1rem)`.
 */
export const TILE =
  "min-w-0 shrink-0 snap-start w-[calc((100%-0.5rem)/2)] @md:w-[calc((100%-1rem)/3)] @2xl:w-[calc((100%-1.5rem)/4)] @3xl:w-[calc((100%-2rem)/5)] @5xl:w-[calc((100%-2.5rem)/6)]";

/**
 * The box a tile lives in: nothing at rest, a soft panel under the whole tile — artwork, title
 * and subtitle together — on hover. The padding is what the panel needs to read as a container
 * rather than a highlight, and `TILE` is wider by exactly that much, so the artwork is the size
 * it always was. Shared so a shelf of songs, artists and releases behaves as one thing.
 */
export const TILE_BOX =
  "block rounded-[var(--r-lg)] p-2 transition duration-200 ease-[var(--ease)] hover:bg-[var(--surface-2)]";

/**
 * What a cover looks like when there is no art.
 *
 * This is not a rare state: when a provider or the art proxy is unreachable it is *every* cover
 * on the page at once, which is how the shelves currently look here — rows of outlined boxes
 * with a grey note centred in each. A flat `--surface-2` fill reads as a picture that failed to
 * arrive. This reads as the place a picture goes: a ground lit from the top-left, warm pink at
 * the corner and sinking to the page colour, with a soft accent bloom under the middle where
 * the note sits. Every value is a token, so it is the same object in both themes and under a
 * custom accent.
 *
 * It also covers the gap before a cover loads, so a shelf arrives coloured rather than blank.
 */
export const COVER_EMPTY =
  "bg-[image:radial-gradient(66%_66%_at_50%_43%,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_72%),radial-gradient(125%_125%_at_12%_-6%,var(--surface-3),var(--surface-2)_52%,var(--bg))]";

/**
 * The note that sits on `COVER_EMPTY` — a watermark in the accent, not a grey error glyph.
 *
 * 80, and not the 60 this started at, because dimming works backwards between the two themes:
 * on the dark page a lower opacity pulls the glyph toward the ink and it keeps its contrast, on
 * the blush one it pulls it toward the page and washes out. Measured on the light surfaces it
 * lands on, 60 and 70 both sit under the 3:1 a non-text graphic needs; 80 clears it at 3.38 on
 * `--surface-1` and 3.02 on `--surface-3`. This is the glyph every tile in the app shows when
 * the art proxy is down, so it is not a detail.
 */
export const COVER_NOTE = "text-[var(--accent-text)] opacity-80";

/**
 * Cover, then title, then subtitle, and the space between them is what makes the three read as
 * one object. It was 12px, which let the title float far enough from the cover to look like a
 * caption printed underneath rather than part of the tile. The references all sit the title
 * tight under the art and let the art carry the weight.
 *
 * The line heights are declared rather than inherited so that the text block is exactly two
 * lines tall on every tile, whatever the title is — a shelf of tiles whose text blocks are all
 * the same height is the difference between a row and a pile.
 */
export const TILE_TITLE =
  "mt-2 block truncate text-[length:var(--text-meta)] font-bold leading-5 tracking-[var(--track-body)]";
export const TILE_SUBTITLE = "mt-0.5 block truncate text-xs leading-4 text-[var(--fg-dim)]";

/**
 * How many tiles to load without waiting to be scrolled to.
 *
 * Every cover in the app was `loading="lazy"`, including the ones already on screen, so a shelf
 * arrived as a row of empty outlined boxes and filled in afterwards — which reads as broken
 * rather than as loading. Six is the most a shelf shows at 1536px; past that, lazy is right.
 */
export const EAGER_TILES = 6;

export function SongTiles({ songs, queue = songs }: { songs: Song[]; queue?: Song[] }) {
  return songs.map((song, index) => (
    <div key={song.id} className={TILE}>
      <SongCard song={song} queue={queue} eager={index < EAGER_TILES} />
    </div>
  ));
}

export function SongCard({
  song,
  queue,
  eager,
}: {
  song: Song;
  queue: Song[];
  eager?: boolean;
}) {
  const { play, enqueue, current, state, queue: playerQueue } = usePlayerControls();
  const isCurrent = current?.id === song.id;
  const isPlaying = isCurrent && state === "playing";
  const isQueued = playerQueue.some((queued) => sameTrack(queued, song));

  // No right-click menu here, deliberately. A tile is big enough to carry its own controls —
  // the queue and playlist buttons appear on the artwork on hover — so the menu belongs to the
  // list rows, where a song is a line of text beside a thumbnail and there is nowhere to put them.
  return (
    <div className={`group relative w-full text-left ${TILE_BOX}`}>
      <div className="relative">
        <div
          className={`slab-sm press relative aspect-square overflow-hidden rounded-[var(--r-md)] ${COVER_EMPTY}`}
        >
          <Artwork
            // 500x500 arriving for a 168px box: 14 covers on /explore cost 702 kB where the six
            // that already went through sized() cost 27 kB between them. sized() snaps to each
            // provider's own ladder and never upscales.
            src={sized(song.artworkUrl, 256)}
            eager={eager}
            // Not --ease, and not `transition` (all properties).
            //
            // --ease is cubic-bezier(0.32, 0.72, 0, 1): it covers 66% of the distance in the
            // first 20% of the duration and 95% by halfway. That is excellent for something
            // arriving, and wrong for a state that reverses — CSS runs the same curve backwards,
            // so the zoom-out dropped almost all the way in about 100ms of a 500ms transition and
            // then crawled the last few percent. It reads as a snap, which is exactly what it
            // was reported as. A symmetric curve leaves and returns at the same rate.
            className="size-full transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:scale-[1.04]"
            surfaceClassName={COVER_EMPTY}
            noteClassName={COVER_NOTE}
            iconClassName="size-8"
          />


          {/* The ring has to be drawn *inside* this one. It fills the artwork exactly, and the
              artwork clips its overflow — an outside ring would be cut off by the very box it is
              meant to outline, leaving the tile's main control with no visible focus at all.
              `.focus-ring-inset` is that ring, from globals.css. It was a Tailwind arbitrary
              property here and it never applied: the browser computed the ordinary outside ring
              instead, so a focused tile showed nothing at all. */}
          <button
            type="button"
            onClick={() => play(song, queue)}
            aria-label={`Play ${song.title}`}
            title={`Play ${song.title}`}
            className="focus-ring-inset absolute inset-0 z-10 cursor-pointer rounded-[var(--r-md)]"
          />

          {/* Hover-only on purpose, and the `touch:` escape the two buttons below carry is
              deliberately absent here. This is a picture of what a click would do, not a thing
              you can press — `pointer-events-none`, `aria-hidden`, and the whole cover is already
              the Play button. Drawn always on a phone it is a 40px disc over a 150px cover that
              does nothing you could not do by tapping the artwork, and it was the single biggest
              thing in the way once the real controls came back. */}
          <span
            aria-hidden
            className={`slab-sm tint pointer-events-none absolute bottom-2 right-2 z-20 flex size-10 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-fg)] transition duration-300 ease-[var(--ease)] ${
              isPlaying
                ? "translate-y-0 opacity-100"
                : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
            }`}
            style={{ background: "var(--accent)" }}
          >
            <PlayGlyph playing={isPlaying} />
          </span>

          <button
            type="button"
            onClick={() => enqueue([song])}
            disabled={isQueued}
            aria-label={isQueued ? `${song.title} is in the queue` : `Add ${song.title} to queue`}
            title={isQueued ? "In the queue" : "Add to queue"}
            className={`slab-sm absolute bottom-2 left-2 z-20 flex size-8 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-1)] text-[var(--fg)] transition duration-300 ease-[var(--ease)] disabled:cursor-default disabled:text-[var(--fg-dim)] ${
              isQueued
                ? "translate-y-0 opacity-100"
                : "translate-y-2 opacity-0 hover:bg-[var(--surface-2)] group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 touch:translate-y-0 touch:opacity-100"
            }`}
          >
            {isQueued ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
          </button>
        </div>

        {/* Last in the DOM, first in the corner. It is absolutely positioned, so where it sits is
            not where it comes: putting it ahead of the artwork made it the first thing a keyboard
            reached, and arrow-walking a shelf landed on "save to a playlist" for every tile
            instead of on Play. Play is the tile, so Play goes first. */}
        {/* On a pointer this glyph appears over a tile that has just gone `hover:bg-surface-2`,
            so it always has something to sit on. Drawn at rest on a touch screen it is a bare
            `--fg-dim` mark on whatever the cover happens to be, and on a bright one it vanishes —
            revealed but still no sign it is there. So on touch it gets the same chip the queue
            button beside it already wears. */}
        <div className="absolute right-2 top-2 z-30 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 touch:rounded-[var(--r-full)] touch:bg-[var(--surface-1)] touch:opacity-100 touch:shadow-[var(--drop-sm)]">
          <AddToPlaylist song={song} />
        </div>
      </div>

      {/* A second way to click the same song, for the mouse. It is `tabIndex={-1}` and
          `aria-hidden` because the artwork above already carries "Play {title}" — announcing it
          twice is noise — and because the artist link below can no longer be inside it: a link
          nested in a button is dropped from the accessibility tree entirely. */}
      <button
        type="button"
        onClick={() => play(song, queue)}
        tabIndex={-1}
        aria-hidden
        className="block w-full text-left"
      >
        {/* One line, on purpose. A title long enough to be cut is cut mid-word — there is no CSS
            that ellipsises on a word boundary — so the `title` attribute carries the rest, and
            the clamp stays at one line because two would reserve a second line box on every
            tile in the app and 690px of window has no room to spare. */}
        <p
          title={song.title}
          className={`tint ${TILE_TITLE} ${isCurrent ? "text-[var(--accent-text)]" : ""}`}
        >
          {song.title}
        </p>
      </button>

      {/* Spelled out rather than `TILE_SUBTITLE`, for one class: this is the only tile subtitle
          that is a link, and `truncate` is `overflow: hidden`. The ring is a box-shadow drawn 4px
          outside the border box, so the paragraph clipped it off top, bottom and left, and a
          focused artist name wore a flat band with square ends instead of a ring. The link
          truncates itself instead — `max-w-full` is the same ellipsis at the same place, and
          `align-top` keeps an inline-block from sitting on the baseline and making the line 3px
          taller than every other tile's. Everything else is TILE_SUBTITLE to the letter. */}
      <p className="mt-0.5 text-xs leading-4 text-[var(--fg-dim)]">
        <ArtistLink artists={song.artists} className="inline-block max-w-full truncate align-top" />
      </p>
    </div>
  );
}
