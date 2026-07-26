"use client";

import { NoteIcon, PlayIcon } from "./icons";
import { usePlayer } from "./player/player-context";
import { sourceStyle } from "./sources";
import type { Song } from "./types";

/**
 * A song as a browsable tile.
 *
 * Clicking **plays it here**, in the player bar. Chart entries usually come
 * from Deezer or Apple, which Timbre cannot drive, so the player resolves a
 * YouTube Music copy first — the cross-source match applied at play time.
 */
export function SongCard({ song, queue }: { song: Song; queue: Song[] }) {
  const { play, current, state } = usePlayer();
  const isCurrent = current?.id === song.id;

  return (
    <button
      type="button"
      onClick={() => play(song, queue)}
      className="group text-left focus:outline-none"
      title={`Play ${song.title}`}
    >
      <div
        className={`relative aspect-square overflow-hidden rounded-lg bg-[var(--surface-hover)] ring-1 transition ${
          isCurrent ? "ring-2 ring-[var(--accent)]" : "ring-[var(--border)] group-hover:ring-[var(--accent)]"
        }`}
      >
        {song.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img
            src={song.artworkUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-[var(--muted)]">
            <NoteIcon className="size-6" />
          </span>
        )}

        <span
          className={`absolute inset-0 flex items-center justify-center bg-black/50 transition ${
            isCurrent && state === "playing"
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          }`}
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
            <PlayIcon className="size-4 translate-x-px" />
          </span>
        </span>

        <span className="absolute bottom-1 left-1 flex gap-0.5">
          {song.sources.map((source) => (
            <span
              key={source.source}
              title={sourceStyle(source.source).label}
              aria-label={sourceStyle(source.source).label}
              style={{ backgroundColor: sourceStyle(source.source).color }}
              className="size-1.5 rounded-full ring-1 ring-black/30"
            />
          ))}
        </span>
      </div>

      <p
        className={`mt-1.5 truncate text-xs font-medium ${isCurrent ? "text-[var(--accent)]" : ""}`}
      >
        {song.title}
      </p>
      <p className="truncate text-[11px] text-[var(--muted)]">
        {song.artists.join(", ") || "Unknown artist"}
      </p>
    </button>
  );
}
