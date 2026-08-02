"use client";

import { ArtistLink } from "./artist-link";
import { Artwork } from "./artwork";
import { CheckIcon, PlayIcon, PlusIcon } from "./icons";
import { usePlayer } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import type { Song } from "./types";

/**
 * A song as a browsable tile.
 *
 * Clicking **plays it here**, in the player bar. Chart entries usually come
 * from Deezer or Apple, which Timbre cannot drive, so the player resolves a
 * YouTube Music copy first — the cross-source match applied at play time.
 *
 * The play affordance slides up from the artwork's bottom-right on hover rather
 * than dimming the whole cover behind a scrim. Covering the art to offer to play
 * it hides the one thing the tile exists to show; a corner button leaves it
 * intact.
 *
 * **Two actions, so the tile cannot be one button.** Queueing sits beside
 * playing, and a button may not contain another — the inner one is dropped and
 * assistive technology sees a single unlabelled target. The cover is therefore a
 * container holding a full-bleed play button, with the queue control layered
 * above it.
 */
export function SongCard({ song, queue }: { song: Song; queue: Song[] }) {
  const { play, enqueue, current, state, queue: playerQueue } = usePlayer();
  const isCurrent = current?.id === song.id;
  const isPlaying = isCurrent && state === "playing";
  const isQueued = playerQueue.some((queued) => queued.id === song.id);

  return (
    <div className="group relative w-full text-left">
      {/*
        Saving to a playlist, top-right — clear of the queue control at
        bottom-left and the play affordance at bottom-right.

        Positioned by this wrapper rather than by a class on <AddToPlaylist>.
        Its own root is `relative`, because the menu is absolute against it, and
        Tailwind emits `.relative` after `.absolute` — so passing `absolute`
        through loses and the button drops into normal flow above the artwork.

        Outside the cover too: that box is `overflow-hidden` for its rounded
        corners, which would clip the menu this opens.
      */}
      <div className="absolute right-2 top-2 z-30 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        <AddToPlaylist song={song} />
      </div>

      <div className="slab press relative aspect-square overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-2)]">
        <Artwork
          src={song.artworkUrl}
          className="size-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
          iconClassName="size-7"
        />

        {/* A soft foot to the image so source dots and the button keep contrast
            against pale artwork without dimming the whole cover. */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition group-hover:opacity-100" />

        {/* The cover itself is the play target, so the whole tile still plays
            on click the way it always did. */}
        <button
          type="button"
          onClick={() => play(song, queue)}
          aria-label={`Play ${song.title}`}
          title={`Play ${song.title}`}
          className="absolute inset-0 z-10 cursor-pointer focus:outline-none"
        />

        {/* Purely a picture of the action — the button above it takes the
            click, so this must not intercept one. */}
        <span
          aria-hidden
          className={`slab-sm tint pointer-events-none absolute bottom-2 right-2 z-20 flex size-10 items-center justify-center rounded-[var(--r-md)] text-[var(--accent-fg)] transition duration-300 ease-[var(--ease)] ${
            isPlaying
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
          }`}
          style={{ background: "var(--accent)" }}
        >
          {isPlaying ? (
            <span className="eq flex h-3.5 items-end gap-[3px]">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <PlayIcon className="size-[18px] translate-x-px" />
          )}
        </span>

        {/*
          Queueing, opposite the play button.
          Already-queued tiles keep the control visible and show a tick instead
          of hiding it, because "nothing happened" and "it is already in there"
          are otherwise indistinguishable — the common confusion with an add
          button that silently no-ops on a duplicate.
        */}
        <button
          type="button"
          onClick={() => enqueue([song])}
          disabled={isQueued}
          aria-label={isQueued ? `${song.title} is in the queue` : `Add ${song.title} to queue`}
          title={isQueued ? "In the queue" : "Add to queue"}
          className={`slab-sm absolute bottom-2 left-2 z-20 flex size-8 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-1)] text-[var(--fg)] transition duration-300 ease-[var(--ease)] disabled:cursor-default disabled:text-[var(--fg-dim)] ${
            isQueued
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0 hover:bg-[var(--surface-2)] group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100"
          }`}
        >
          {isQueued ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
        </button>
      </div>

      <button
        type="button"
        onClick={() => play(song, queue)}
        tabIndex={-1}
        className="block w-full text-left focus:outline-none"
      >
        <p
          className={`tint mt-2.5 truncate text-[13px] font-medium ${
            isCurrent ? "text-[var(--accent)]" : ""
          }`}
        >
          {song.title}
        </p>
        <p className="truncate text-xs text-[var(--fg-dim)]">
          <ArtistLink artists={song.artists} />
        </p>
      </button>
    </div>
  );
}
