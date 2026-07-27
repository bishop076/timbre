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
 *
 * The play affordance slides up from the artwork's bottom-right on hover rather
 * than dimming the whole cover behind a scrim. Covering the art to offer to play
 * it hides the one thing the tile exists to show; a corner button leaves it
 * intact.
 */
export function SongCard({ song, queue }: { song: Song; queue: Song[] }) {
  const { play, current, state } = usePlayer();
  const isCurrent = current?.id === song.id;
  const isPlaying = isCurrent && state === "playing";

  return (
    <button
      type="button"
      onClick={() => play(song, queue)}
      className="group w-full text-left focus:outline-none"
      title={`Play ${song.title}`}
    >
      <div className="relative aspect-square overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-2)]">
        {song.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img
            src={song.artworkUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-[var(--fg-faint)]">
            <NoteIcon className="size-7" />
          </span>
        )}

        {/* A soft foot to the image so source dots and the button keep contrast
            against pale artwork without dimming the whole cover. */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition group-hover:opacity-100" />

        <span
          className={`tint absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-full text-[var(--accent-fg)] shadow-lg transition duration-300 ease-[var(--ease)] ${
            isPlaying
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
          }`}
          style={{ background: "var(--accent)" }}
        >
          {isPlaying ? (
            <span aria-hidden className="eq flex h-3.5 items-end gap-[3px]">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <PlayIcon className="size-[18px] translate-x-px" />
          )}
        </span>

        <span className="absolute left-2 top-2 flex gap-1">
          {song.sources.map((source) => (
            <span
              key={source.source}
              title={sourceStyle(source.source).label}
              aria-label={sourceStyle(source.source).label}
              style={{ backgroundColor: sourceStyle(source.source).color }}
              className="size-1.5 rounded-full opacity-0 shadow transition group-hover:opacity-100"
            />
          ))}
        </span>
      </div>

      <p
        className={`tint mt-2.5 truncate text-[13px] font-medium ${
          isCurrent ? "text-[var(--accent)]" : ""
        }`}
      >
        {song.title}
      </p>
      <p className="truncate text-xs text-[var(--fg-dim)]">
        {song.artists.join(", ") || "Unknown artist"}
      </p>
    </button>
  );
}
