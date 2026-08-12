"use client";

import { useState } from "react";

import {
  ChevronIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SpinnerIcon,
} from "../icons";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { LyricsPanel } from "./lyrics-panel";
import { usePlayer } from "./player-context";
import { Scrub } from "./wavy-progress";

/** `m:ss`, for the times either side of the scrubber. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * The phone's full-screen transport, shown under the expanded player.
 *
 * Every phone music app has this screen: cover, title, a scrubber with times,
 * and controls big enough to hit with a thumb. Timbre had the expanded video
 * but none of the controls — they stayed in the mini bar at the bottom, which
 * meant the "full screen" view was a video you could not drive.
 *
 * **The picture above this is the video, not the cover art**, and that is not a
 * design choice. YouTube's terms require the player to stay visible whenever
 * its audio is playing, so the slot every other app fills with a static sleeve
 * is the player itself here. It also cannot be re-mounted into this component:
 * a re-parented iframe reloads, which stops playback dead. So this is the
 * controls only, rendered as a sibling beneath the player that already exists.
 */
export function MobileTransport() {
  const {
    current,
    state,
    position,
    duration,
    seek,
    toggle,
    next,
    previous,
    index,
    queue,
    radio,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    toggleTheater,
  } = usePlayer();

  const [showLyrics, setShowLyrics] = useState(false);

  const playing = state === "playing";
  const busy = state === "loading" || state === "resolving";
  const hasNext = index + 1 < queue.length || radio.length > 0;

  const mode = (label: string, on: boolean, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={`press flex size-11 items-center justify-center rounded-[var(--r-full)] transition ${
        on ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)]"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex min-h-0 shrink flex-col gap-3 px-4 pb-3 pt-3">
      {/*
        A bar across the top: collapse, where it is, and the lyrics toggle.

        Every phone player puts the way out at the top-left and its extras at
        the top-right, so the thumb learns one place for each. Collapse used to
        sit beside the song title, which put "leave this screen" a few pixels
        from "add this to a playlist".
      */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheater}
          aria-label="Collapse player"
          className="slab-sm press flex size-9 shrink-0 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg-dim)]"
        >
          <ChevronIcon className="size-[18px]" />
        </button>

        <p className="flex-1 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
          Now playing
        </p>

        {/*
          Lyrics open *below* the video rather than replacing it.

          They cannot replace it: YouTube's terms require the player to stay
          visible while its audio plays, so a lyrics-only screen is not
          available here the way it is in an app that owns its audio. Under the
          video is both compliant and what was asked for.
        */}
        <button
          type="button"
          onClick={() => setShowLyrics((open) => !open)}
          aria-pressed={showLyrics}
          aria-label={showLyrics ? "Hide lyrics" : "Show lyrics"}
          className={`slab-sm press flex size-9 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[11px] font-bold transition ${
            showLyrics ? "tint text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--fg-dim)]"
          }`}
        >
          Aa
        </button>
      </div>

      {/* Title and artist, centred — the cover above is the subject, and a
          left-aligned title beside nothing reads as a list row. */}
      <div className="min-w-0 text-center">
        <p className="truncate text-lg font-extrabold leading-tight">
          {current?.title ?? "Nothing playing"}
        </p>
        <p className="truncate text-sm text-[var(--fg-dim)]">
          {current?.artists.join(", ") || "Unknown artist"}
        </p>
      </div>

      {/* Scrubber, with the times below it rather than beside — a phone has no
          width to spare either side of the bar. */}
      <div>
        <Scrub position={position} duration={duration} playing={playing} onSeek={seek} />
        <div className="mt-0.5 flex justify-between font-mono text-[11px] tabular-nums text-[var(--fg-faint)]">
          <span>{clock(position)}</span>
          <span>{clock(duration)}</span>
        </div>
      </div>

      {/* Transport. Deliberately large: this is the one screen designed to be
          used without looking closely at it. */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={previous}
          disabled={!current || index === 0}
          aria-label="Previous track"
          className="slab-sm press flex h-12 w-16 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40"
        >
          <PrevIcon className="size-5" />
        </button>

        <button
          type="button"
          onClick={toggle}
          disabled={!current || state === "unplayable"}
          aria-label={playing ? "Pause" : "Play"}
          className="slab press tint flex size-16 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-fg)] disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {busy ? (
            <SpinnerIcon className="size-7 animate-spin" />
          ) : playing ? (
            <PauseIcon className="size-7" />
          ) : (
            <PlayIcon className="size-7 translate-x-px" />
          )}
        </button>

        <button
          type="button"
          onClick={next}
          disabled={!hasNext}
          aria-label="Next track"
          className="slab-sm press flex h-12 w-16 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40"
        >
          <NextIcon className="size-5" />
        </button>
      </div>

      {/*
        Modes and save, gathered into one strip.

        They belong together because none of them acts on the song *now* — they
        change how the queue behaves next, or what happens after it. Saving used
        to sit beside the title where it shared an edge with "collapse".
      */}
      <div className="slab-sm mx-auto flex items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-2">
        {mode("Shuffle", shuffle, toggleShuffle, <ShuffleIcon className="size-[18px]" />)}
        {mode(
          repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat queue" : "Repeat off",
          repeat !== "off",
          cycleRepeat,
          repeat === "one" ? (
            <RepeatOneIcon className="size-[18px]" />
          ) : (
            <RepeatIcon className="size-[18px]" />
          ),
        )}
        {current && (
          <AddToPlaylist song={current} className="flex size-11 items-center justify-center" />
        )}
      </div>

      {/*
        Lyrics, under everything, and scrolling on their own.

        `min-h-0` is load-bearing on a flex child that scrolls: without it the
        panel refuses to shrink below its content and pushes the transport off
        the bottom of the screen — the controls would leave rather than the
        lyrics scrolling.
      */}
      {showLyrics && (
        <div className="min-h-0 flex-1 overflow-hidden border-t-[length:var(--edge)] border-[var(--ink)] pt-2">
          <LyricsPanel />
        </div>
      )}
    </div>
  );
}
