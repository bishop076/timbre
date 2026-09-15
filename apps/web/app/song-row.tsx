"use client";

import type { ReactNode } from "react";

import { moveBetweenItems } from "./a11y/arrow-nav";
import { ArtistLink } from "./artist-link";
import { Artwork } from "./artwork";
import { sized } from "./artwork-url";
import { formatDuration } from "./duration";
import { PlayIcon } from "./icons";
import { AddToQueue } from "./player/add-to-queue";
import { usePlayerControls } from "./player/player-context";
import { useSongMenu } from "./player/song-menu";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import type { Song } from "./types";

const MEDIUM = {
  row: "gap-3 sm:gap-4",
  play: "gap-2.5 py-2 sm:gap-4 sm:py-3",
  rank: "text-[length:var(--text-meta)]",
  thumb: "size-10 sm:size-12",
  note: "size-5",
  icon: "size-4",
  title: "text-[length:var(--text-body)]",
  subtitle: "text-[length:var(--text-meta)]",
};

const SCALE = {
  sm: {
    row: "gap-2.5 sm:gap-3",
    play: "gap-2.5 py-2 sm:gap-3 sm:py-2.5",
    rank: "text-[length:var(--text-meta)] font-bold",
    thumb: "size-10 sm:size-11",
    note: "size-4",
    icon: "size-4",
    title: "text-[length:var(--text-meta)]",
    subtitle: "text-[12px]",
  },
  md: MEDIUM,
  lg: { ...MEDIUM, play: "gap-3 py-3 sm:gap-4", thumb: "size-12", icon: "size-5" },
};

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
  isPlaying: boolean;
  rank?: ReactNode;
  rankPlays?: boolean;
  subtitle: ReactNode;
  trailing?: ReactNode;
  size?: keyof typeof SCALE;
  thumbnail?: boolean;
}) {
  const scale = SCALE[size];
  const showing = isCurrent && isPlaying;
  const { onContextMenu, menu } = useSongMenu(song);

  const gutter =
    rank === undefined ? null : (
      <span className={`w-6 shrink-0 text-right tabular-nums text-[var(--fg-faint)] ${scale.rank}`}>
        {rank}
      </span>
    );

  // The play target used to be a <button> wrapping the whole line, artist link and all — and an
  // artist link inside a button is a link no screen reader can reach. ARIA calls a button's
  // contents presentational: the role="link" is discarded and its text is read out as part of the
  // button's own name. So the button stops wrapping and starts covering instead. It sits behind
  // the line at inset-0, the text above it ignores the pointer, and anything that is genuinely
  // its own control — the artist link, the trailing buttons — opts back in. Same click target,
  // same picture, one less lie in the tree.
  return (
    <li
      onContextMenu={onContextMenu}
      onKeyDown={(event) => moveBetweenItems(event, event.currentTarget.parentElement, "vertical")}
      className={`group relative isolate flex items-center px-2 ${scale.row} before:absolute before:inset-0 before:-z-10 before:rounded-[var(--r-md)] before:transition ${
        isCurrent ? "before:bg-[var(--accent-wash)]" : "hover:before:bg-[var(--surface-2)]"
      }`}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${song.title}`}
        className="absolute inset-0 z-0 rounded-[var(--r-md)]"
      />

      {rankPlays ? null : gutter}

      <div
        className={`pointer-events-none relative z-10 flex min-w-0 flex-1 items-center text-left ${scale.play}`}
      >
        {rankPlays ? gutter : null}

        {thumbnail && (
          <span className={`relative shrink-0 ${scale.thumb}`}>
            <Artwork
              src={sized(song.artworkUrl, 112)}
              className="slab-sm size-full rounded-[var(--r-sm)]"
              iconClassName={scale.note}
              surfaceClassName="bg-[var(--surface-1)]"
              noteClassName="text-[var(--fg-dim)]"
            />
            <span
              className={`absolute inset-0 flex items-center justify-center rounded-[var(--r-sm)] bg-black/55 transition ${
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
            className={`block truncate font-medium tracking-[var(--track-body)] ${scale.title} ${
              isCurrent ? "text-[var(--accent-text)]" : ""
            }`}
          >
            {song.title}
          </span>
          <span className={`block truncate text-[var(--fg-dim)] ${scale.subtitle}`}>{subtitle}</span>
        </span>
      </div>

      {trailing && (
        <span className={`relative z-10 flex shrink-0 items-center ${scale.row}`}>{trailing}</span>
      )}
      {menu}
    </li>
  );
}

export function RankedList<T extends Song & { position: number }>({
  songs,
  queue = songs,
  extra,
  addToQueue = false,
}: {
  songs: T[];
  queue?: T[];
  extra: (song: T, index: number) => ReactNode;
  addToQueue?: boolean;
}) {
  const { play, current, state } = usePlayerControls();

  return (
    <ul className="divide-y divide-[var(--line)]">
      {songs.map((song, index) => (
        <SongRow
          key={song.id}
          song={song}
          onPlay={() => play(song, queue)}
          isCurrent={current?.id === song.id}
          isPlaying={state === "playing"}
          size="sm"
          rank={song.position}
          rankPlays
          subtitle={<ArtistLink artists={song.artists} />}
          trailing={
            <>
              {extra(song, index)}
              <AddButtons song={song} queue={addToQueue} />
            </>
          }
        />
      ))}
    </ul>
  );
}

export function SongActions({
  song,
  queue = true,
  durationClassName = "",
}: {
  song: Song;
  queue?: boolean;
  durationClassName?: string;
}) {
  return (
    <>
      <span
        className={`hidden w-12 shrink-0 text-right font-mono text-[length:var(--text-meta)] tabular-nums text-[var(--fg-dim)] @md:block ${durationClassName}`}
      >
        {formatDuration(song.durationMs)}
      </span>
      <AddButtons song={song} queue={queue} />
    </>
  );
}

function AddButtons({ song, queue }: { song: Song; queue: boolean }) {
  return (
    <>
      {queue && (
        <AddToQueue
          song={song}
          className="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
        />
      )}
      <AddToPlaylist
        song={song}
        className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
      />
    </>
  );
}
