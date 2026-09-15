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

export const TILE = "w-[8rem] shrink-0 snap-start sm:w-[11.5rem]";

/**
 * The box a tile lives in: nothing at rest, a soft panel under the whole tile — artwork, title
 * and subtitle together — on hover. The padding is what the panel needs to read as a container
 * rather than a highlight, and `TILE` is wider by exactly that much, so the artwork is the size
 * it always was. Shared so a shelf of songs, artists and releases behaves as one thing.
 */
export const TILE_BOX =
  "block rounded-[var(--r-lg)] p-2 transition duration-200 ease-[var(--ease)] hover:bg-[var(--surface-2)]";

/**
 * How many tiles to load without waiting to be scrolled to.
 *
 * Every cover in the app was `loading="lazy"`, including the ones already on screen, so a shelf
 * arrived as a row of empty outlined boxes and filled in afterwards — which reads as broken
 * rather than as loading. Six is the most a shelf shows at 1536px; past that, lazy is right.
 */
const EAGER_TILES = 6;

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
        <div className="slab-sm press relative aspect-square overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)]">
          <Artwork
            // 500x500 arriving for a 168px box: 14 covers on /explore cost 702 kB where the six
            // that already went through sized() cost 27 kB between them. sized() snaps to each
            // provider's own ladder and never upscales.
            src={sized(song.artworkUrl, 256)}
            eager={eager}
            className="size-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
            iconClassName="size-7"
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
                : "translate-y-2 opacity-0 hover:bg-[var(--surface-2)] group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
            }`}
          >
            {isQueued ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
          </button>
        </div>

        {/* Last in the DOM, first in the corner. It is absolutely positioned, so where it sits is
            not where it comes: putting it ahead of the artwork made it the first thing a keyboard
            reached, and arrow-walking a shelf landed on "save to a playlist" for every tile
            instead of on Play. Play is the tile, so Play goes first. */}
        <div className="absolute right-2 top-2 z-30 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
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
        <p
          className={`tint mt-2.5 truncate text-[length:var(--text-meta)] font-bold tracking-[var(--track-body)] sm:mt-3 ${
            isCurrent ? "text-[var(--accent)]" : ""
          }`}
        >
          {song.title}
        </p>
      </button>

      <p className="mt-0.5 truncate text-xs text-[var(--fg-dim)]">
        <ArtistLink artists={song.artists} />
      </p>
    </div>
  );
}
