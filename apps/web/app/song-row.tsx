"use client";

import type { ReactNode } from "react";

import { Artwork } from "./artwork";
import { sized } from "./artwork-url";
import { PlayIcon } from "./icons";
import { useSongMenu } from "./player/song-menu";
import type { Song } from "./types";

/** Row scale: `sm` for chart lists, `md` for library lists, `lg` for search results. */
export type SongRowSize = "sm" | "md" | "lg";

const SCALE = {
  sm: {
    row: "gap-2.5 sm:gap-3",
    play: "gap-2.5 py-2 sm:gap-3 sm:py-2.5",
    rank: "text-[13px] font-bold",
    thumb: "size-10 sm:size-11",
    note: "size-4",
    icon: "size-4",
    title: "text-[14px]",
    subtitle: "text-[12px]",
  },
  md: {
    row: "gap-3 sm:gap-4",
    play: "gap-2.5 py-2 sm:gap-4 sm:py-3",
    rank: "text-xs",
    thumb: "size-10 sm:size-12",
    note: "size-5",
    icon: "size-4",
    title: "text-[15px]",
    subtitle: "text-sm",
  },
  lg: {
    row: "gap-3 sm:gap-4",
    play: "gap-3 py-3 sm:gap-4",
    rank: "text-xs",
    thumb: "size-14",
    note: "size-5",
    icon: "size-5",
    title: "text-[15px]",
    subtitle: "text-sm",
  },
} as const;

/** One song in a list: play target, artwork, title over a subtitle, trailing controls. */
export function SongRow({
  song,
  onPlay,
  isCurrent,
  isPlaying,
  rank,
  rankPlays = false,
  subtitle,
  trailing,
  size = "md",
  thumbnail = true,
}: {
  song: Song;
  onPlay: () => void;
  isCurrent: boolean;
  /** Whether the player is playing; only read when `isCurrent`. */
  isPlaying: boolean;
  /** Leading gutter — a number, or anything else 24px wide. Absent when undefined. */
  rank?: ReactNode;
  /** Put the gutter inside the play button, so pressing the number also plays. */
  rankPlays?: boolean;
  subtitle: ReactNode;
  trailing?: ReactNode;
  size?: SongRowSize;
  /** `false` for a tracklist already sitting under one cover. */
  thumbnail?: boolean;
}) {
  const scale = SCALE[size];
  const showing = isCurrent && isPlaying;

  // Every list of songs gets the same right-click menu by getting it here — search results,
  // an album, a playlist, the charts. Queueing from search was the ask; there is no reason
  // the other four should behave differently, and one insertion point cannot drift.
  const { onContextMenu, menu } = useSongMenu(song);

  const gutter =
    rank === undefined ? null : (
      <span className={`w-6 shrink-0 text-right tabular-nums text-[var(--fg-faint)] ${scale.rank}`}>
        {rank}
      </span>
    );

  return (
    <li
      onContextMenu={onContextMenu}
      className={`group flex items-center rounded-lg px-2 transition ${scale.row} ${
        isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
      }`}
    >
      {rankPlays ? null : gutter}

      <button
        type="button"
        onClick={onPlay}
        className={`flex min-w-0 flex-1 items-center text-left focus:outline-none ${scale.play}`}
        aria-label={`Play ${song.title}`}
      >
        {rankPlays ? gutter : null}

        {thumbnail && (
          <span className={`relative shrink-0 ${scale.thumb}`}>
            {/* Sized but not proxied: `Artwork` proxies, and a pre-proxied URL would defeat
                its retry, which matches on the original YouTube hostname. The placeholder
                tone is the row's own — these rows are `hover:bg-[var(--surface-2)]`, so
                Artwork's default tile vanishes under the cursor. */}
            <Artwork
              src={sized(song.artworkUrl, 112)}
              className="size-full rounded-md"
              iconClassName={scale.note}
              surfaceClassName="bg-[var(--surface-1)]"
              noteClassName="text-[var(--fg-dim)]"
            />
            <span
              className={`absolute inset-0 flex items-center justify-center rounded-md bg-black/55 transition ${
                showing
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}
            >
              <PlayIcon className={`${scale.icon} text-white`} />
            </span>
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate font-medium ${scale.title} ${
              isCurrent ? "text-[var(--accent)]" : ""
            }`}
          >
            {song.title}
          </span>
          <span className={`block truncate text-[var(--fg-dim)] ${scale.subtitle}`}>{subtitle}</span>
        </span>
      </button>

      {trailing}
      {menu}
    </li>
  );
}
