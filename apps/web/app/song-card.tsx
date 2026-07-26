"use client";

import { NoteIcon, PlayIcon } from "./icons";
import { sourceStyle } from "./sources";
import type { Song } from "./types";

/**
 * A song as a browsable tile, for the home page grid.
 *
 * Clicking searches Timbre for the track rather than opening the source
 * directly — most chart entries come from Deezer or Apple, which Timbre cannot
 * play, and searching surfaces the YouTube Music copy that it can. Once the
 * player lands in Phase B this becomes a direct play.
 */
export function SongCard({ song, onPick }: { song: Song; onPick: (query: string) => void }) {
  const query = [song.title, song.artists[0]].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      onClick={() => onPick(query)}
      className="group text-left focus:outline-none"
      title={`Find “${song.title}” on Timbre`}
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-[var(--surface-hover)] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--accent)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)]">
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
            <NoteIcon className="size-8" />
          </span>
        )}

        <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
            <PlayIcon className="size-5 translate-x-px" />
          </span>
        </span>

        <span className="absolute bottom-1.5 left-1.5 flex gap-1">
          {song.sources.map((source) => {
            const style = sourceStyle(source.source);
            return (
              <span
                key={source.source}
                title={style.label}
                aria-label={style.label}
                style={{ backgroundColor: style.color }}
                className="size-2 rounded-full ring-2 ring-black/25"
              />
            );
          })}
        </span>
      </div>

      <p className="mt-2 truncate text-sm font-medium">{song.title}</p>
      <p className="truncate text-xs text-[var(--muted)]">
        {song.artists.join(", ") || "Unknown artist"}
      </p>
    </button>
  );
}
