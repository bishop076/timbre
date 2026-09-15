"use client";

import type { ReactNode } from "react";

import { seededShuffle } from "@/lib/rotation";

import { formatDuration } from "../duration";
import { Equalizer } from "../equalizer";
import { PauseIcon, PlayIcon, ShuffleIcon } from "../icons";
import { EYEBROW } from "../page-chrome";
import { usePlayerControls } from "../player/player-context";
import { samePlace, type QueueOrigin } from "../player/queue-origin.ts";
import type { Song } from "../types";

/**
 * The chrome every detail page shares — an album, a playlist, a chart.
 *
 * It lives beside the album view rather than in page-chrome.tsx because `PageHeader` is the
 * generic one: home, search and the artist page all sit on it, and a detail page wants
 * something narrower than that. The three pages that *are* a tracklist with a Play button on
 * top should agree with each other down to the pixel, and the only way to guarantee that is to
 * have them read the same constants. `PlayRow` already lived in this folder and is imported
 * from `../album/album-view` elsewhere, so this is where its neighbours go.
 */

/**
 * The one control on a detail page allowed to shout: a hot pink pill carrying black, with the
 * same ink edge everything else here wears. It is the only thing on the page at this weight —
 * pressing Play should never be a hunt.
 */
export const DETAIL_PRIMARY =
  "slab press inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--r-full)] px-6 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-40";

/** Everything beside it: same height and same edge, a white pill instead of a pink one. */
export const DETAIL_SECONDARY =
  "slab-sm press inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-1)] px-4 text-[13px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] disabled:opacity-40";

/** The square version, for an action whose icon says it all. */
export const DETAIL_ICON =
  "slab-sm press inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-1)] text-[var(--fg-dim)] transition hover:text-[var(--fg)] disabled:opacity-40";

/**
 * Header artwork: the hero of the page. 160px, not 192 — the header has to clear a 690px-tall
 * window with a tracklist under it, and the cover is the one part that can give height back
 * without anyone missing it. Soft --r-lg corners and the ink edge, as the references draw them.
 */
export const DETAIL_ART = "slab size-28 shrink-0 rounded-[var(--r-lg)] @lg:size-40";

/** The row of controls under the title. Shared so PlayRow and a hand-rolled row line up. */
export const ACTIONS_ROW = "mt-4 flex flex-wrap items-center gap-2";

/** The gap SongRow puts between its gutter, its text and its trailing cells. */
const ROW_GAP = "gap-2.5 sm:gap-3";

export function DetailHeader({
  art,
  eyebrow,
  title,
  meta,
  children,
  note,
  noteLines,
}: {
  art: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  /**
   * Floor for the note's height, in lines. A note that grows a line once something client-side
   * resolves — chart memory, a count read from storage — would otherwise shove the whole
   * tracklist down a moment after the page settles. Reserving the taller of the two shapes up
   * front costs nothing and means the list never moves.
   */
  noteLines?: 3;
}) {
  return (
    <header className="mb-4 flex flex-col gap-4 @lg:mb-6 @lg:flex-row @lg:items-end @lg:gap-6">
      {art}
      <div className="min-w-0 flex-1">
        <p className={EYEBROW}>{eyebrow}</p>
        {/* Clamped at two lines. An untruncated long title used to push Play off a short
            window, which is the one thing a detail page must never do. */}
        <h1 className="mt-1 line-clamp-2 text-[1.75rem] font-extrabold leading-[1.06] tracking-[-0.022em] @lg:text-[2.25rem] @3xl:text-[2.5rem]">
          {title}
        </h1>
        {meta && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-[var(--fg-dim)]">
            {meta}
          </p>
        )}
        {children}
        {note && (
          <p
            className={`mt-2.5 max-w-prose text-[11px] leading-relaxed text-[var(--fg-faint)] ${
              noteLines === 3 ? "min-h-[3lh]" : ""
            }`}
          >
            {note}
          </p>
        )}
      </div>
    </header>
  );
}

/** The separator in a meta line, as one thing so every page uses the same character. */
export function Dot() {
  return <span aria-hidden>·</span>;
}

/** "13 tracks · 74 min", when the durations are known. */
export function totalTime(songs: readonly { durationMs: number | null }[]): string | null {
  const ms = songs.reduce((sum, song) => sum + (song.durationMs ?? 0), 0);
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function PlayRow({
  songs,
  origin,
  shuffle = false,
  children,
}: {
  songs: Song[];
  origin?: QueueOrigin;
  shuffle?: boolean;
  children?: React.ReactNode;
}) {
  const { play, queueOrigin, state, toggle } = usePlayerControls();
  if (songs.length === 0 && !children) return null;

  // Playing *this* list, rather than merely playing something.
  const mine = samePlace(queueOrigin, origin);
  const playingMine = mine && state === "playing";

  return (
    <div className={ACTIONS_ROW}>
      {songs.length > 0 && (
        <button
          type="button"
          onClick={() => (mine ? toggle() : play(songs[0]!, songs, undefined, origin))}
          className={DETAIL_PRIMARY}
          style={{ background: "var(--accent)" }}
        >
          {playingMine ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          {playingMine ? "Pause" : "Play"}
        </button>
      )}
      {shuffle && songs.length > 1 && (
        <button
          type="button"
          onClick={() => {
            const queue = seededShuffle(songs, Math.random() * 2 ** 32);
            if (queue[0]) play(queue[0], queue, undefined, origin);
          }}
          title="Shuffle"
          aria-label="Shuffle"
          className={DETAIL_ICON}
        >
          <ShuffleIcon className="size-4" />
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * The column headings over a tracklist.
 *
 * Nothing here sets a column position: it mirrors SongRow's own flex — a 24px gutter, a
 * flexible title, then fixed cells that anchor to the right edge — so the two line up by
 * construction rather than by a shared magic number. `tail` is the width of whatever buttons
 * that page hangs on the end of a row, which is the only part SongRow does not decide.
 */
export function TrackHead({ album = false, tail }: { album?: boolean; tail?: ReactNode }) {
  return (
    <div
      aria-hidden
      className={`mb-1 hidden items-center border-b-[length:var(--edge)] border-[var(--line)] px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fg-dim)] @md:flex ${ROW_GAP}`}
    >
      <span className="w-6 shrink-0 text-right">#</span>
      <span className="min-w-0 flex-1">Title</span>
      {album && <span className="hidden w-44 shrink-0 @2xl:block">Album</span>}
      <span className="w-12 shrink-0 text-right">Time</span>
      {tail}
    </div>
  );
}

/** The spacer under `TrackHead` for a row that ends in one icon button (AddToPlaylist). */
export const TAIL_ONE = <span className="w-9 shrink-0" />;
/** …and for a row that ends in two (AddToQueue + AddToPlaylist, with SongRow's gap between). */
export const TAIL_TWO = <span className="w-20 shrink-0" />;

/**
 * The album a track came from. Always rendered, even when unknown, so the Time column beside it
 * does not slide about from row to row.
 */
export function AlbumCell({ name }: { name: string | null }) {
  return (
    <span className="hidden w-44 shrink-0 truncate text-[13px] text-[var(--fg-dim)] @2xl:block">
      {name ?? ""}
    </span>
  );
}

/** Same geometry as the duration `SongActions` draws, for lists that build their own trailing. */
export function TimeCell({ ms }: { ms: number | null }) {
  return (
    <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
      {formatDuration(ms)}
    </span>
  );
}

/**
 * What goes in the number column. The index, until this row is the one playing — then the three
 * bouncing bars, in the same 24px box, so the list does not twitch when the track changes.
 */
export function TrackRank({
  position,
  playing,
}: {
  position: number;
  playing: boolean;
}): ReactNode {
  if (!playing) return position;
  return (
    <span className="flex justify-end">
      <Equalizer className="tint h-3 gap-0.5 text-[var(--accent)]" />
    </span>
  );
}
