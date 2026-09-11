"use client";

import { ArtistLink } from "./artist-link";
import { Artwork } from "./artwork";
import { CheckIcon, PlayIcon, PlusIcon } from "./icons";
import { usePlayerControls } from "./player/player-context";
import { useSongMenu } from "./player/song-menu";
import { sameTrack } from "./player/song-match";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import type { Song } from "./types";

export const TILE = "w-[8rem] shrink-0 snap-start sm:w-[11.5rem]";

export function SongCard({ song, queue }: { song: Song; queue: Song[] }) {
  const { play, enqueue, current, state, queue: playerQueue } = usePlayerControls();
  const isCurrent = current?.id === song.id;
  const isPlaying = isCurrent && state === "playing";
  const isQueued = playerQueue.some((queued) => sameTrack(queued, song));
  const { onContextMenu, menu } = useSongMenu(song);

  return (
    <div onContextMenu={onContextMenu} className="tile-card group relative w-full p-2 text-left sm:p-3">
      <div className="relative">
        <div className="absolute right-2 top-2 z-30 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <AddToPlaylist song={song} />
        </div>

        <div className="tile-cover relative aspect-square overflow-hidden rounded-[var(--r-sm)] bg-[var(--surface-2)]">
          <Artwork
            src={song.artworkUrl}
            className="size-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
            iconClassName="size-7"
          />

          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition group-hover:opacity-100" />

          <button
            type="button"
            onClick={() => play(song, queue)}
            aria-label={`Play ${song.title}`}
            title={`Play ${song.title}`}
            className="absolute inset-0 z-10 cursor-pointer focus:outline-none"
          />

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
      </div>

      <button
        type="button"
        onClick={() => play(song, queue)}
        tabIndex={-1}
        className="block w-full px-0.5 pb-0.5 text-left focus:outline-none"
      >
        <p
          className={`tint mt-2.5 truncate text-[13px] font-bold sm:mt-3 sm:text-[14px] ${
            isCurrent ? "text-[var(--accent)]" : ""
          }`}
        >
          {song.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--fg-dim)]">
          <ArtistLink artists={song.artists} />
        </p>
      </button>

      {menu}
    </div>
  );
}
