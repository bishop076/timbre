"use client";

import { useState } from "react";

import { formatElapsed } from "../duration";
import {
  ChevronIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  ShuffleIcon,
  SpinnerIcon,
} from "../icons";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { LikeButton } from "../playlists/like-button";
import { ModeButton, repeatMode } from "../shell/player-bar";
import { LyricsPanel } from "./lyrics-panel";
import { PlaybackMenu } from "./playback-menu";
import { getPlaybackPrefs } from "./playback-prefs";
import { usePlayer } from "./player-context";
import { Scrub } from "./wavy-progress";

// The phone's full-screen transport, shown under the expanded player. The picture above it
// is the video, not cover art — YouTube's terms require the player to stay visible while
// its audio plays, and it cannot be re-mounted here because a re-parented iframe reloads.
// So this is the controls only, rendered as a sibling.
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
    shuffle,
    repeat,
    hasNext,
    toggleShuffle,
    cycleRepeat,
    toggleTheater,
  } = usePlayer();

  // Settings → General decides where this opens; after that the toggle is the reader's.
  const [showLyrics, setShowLyrics] = useState(() => getPlaybackPrefs().lyricsByDefault);

  const playing = state === "playing";
  const busy = state === "loading" || state === "resolving";

  return (
    <div className="flex min-h-0 shrink flex-col gap-3 px-4 pb-3 pt-3">
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

      <div className="min-w-0 text-center">
        <p className="truncate text-lg font-extrabold leading-tight">
          {current?.title ?? "Nothing playing"}
        </p>
        <p className="truncate text-sm text-[var(--fg-dim)]">
          {current?.artists.join(", ") || "Unknown artist"}
        </p>
      </div>

      <div>
        <Scrub position={position} duration={duration} playing={playing} onSeek={seek} />
        <div className="mt-0.5 flex justify-between font-mono text-[11px] tabular-nums text-[var(--fg-faint)]">
          <span>{formatElapsed(position, duration)}</span>
          <span>{formatElapsed(duration, duration)}</span>
        </div>
      </div>

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

      <div className="slab-sm mx-auto flex items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-2">
        <ModeButton
          variant="sheet"
          label="Shuffle"
          on={shuffle}
          onClick={toggleShuffle}
          icon={<ShuffleIcon className="size-[18px]" />}
        />
        <ModeButton
          variant="sheet"
          {...repeatMode(repeat)}
          on={repeat !== "off"}
          onClick={cycleRepeat}
        />
        {current && <LikeButton song={current} className="size-11" />}
        {current && (
          <AddToPlaylist song={current} className="flex size-11 items-center justify-center" />
        )}
        <PlaybackMenu variant="sheet" />
      </div>

      {/* `min-h-0` is load-bearing on a flex child that scrolls: without it the panel
          refuses to shrink and pushes the transport off the bottom of the screen. */}
      {showLyrics && (
        <div className="min-h-0 flex-1 overflow-hidden border-t-[length:var(--edge)] border-[var(--ink)] pt-2">
          <LyricsPanel />
        </div>
      )}
    </div>
  );
}
