"use client";

import { useState } from "react";

import { formatElapsed } from "../duration";
import { ChevronIcon } from "../icons";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { LikeButton } from "../playlists/like-button";
import { ModeButton, Transport } from "../shell/player-bar";
import { LyricsPanel } from "./lyrics-panel";
import { PlaybackMenu } from "./playback-menu";
import { getPlaybackPrefs } from "./playback-prefs";
import { usePlayer } from "./player-context";
import { Scrub } from "./wavy-progress";

export function MobileTransport() {
  const { current, position, duration, toggleTheater } = usePlayer();
  const [showLyrics, setShowLyrics] = useState(() => getPlaybackPrefs().lyricsByDefault);

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
        <Scrub />
        <div className="mt-0.5 flex justify-between font-mono text-[11px] tabular-nums text-[var(--fg-faint)]">
          <span>{formatElapsed(position, duration)}</span>
          <span>{formatElapsed(duration, duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Transport variant="sheet" />
      </div>

      <div className="slab-sm mx-auto flex items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-2">
        <ModeButton mode="shuffle" variant="sheet" />
        <ModeButton mode="repeat" variant="sheet" />
        {current && <LikeButton song={current} className="size-11" />}
        {current && (
          <AddToPlaylist song={current} className="flex size-11 items-center justify-center" />
        )}
        <PlaybackMenu variant="sheet" />
      </div>

      {showLyrics && (
        <div className="min-h-0 flex-1 overflow-hidden border-t-[length:var(--edge)] border-[var(--ink)] pt-2">
          <LyricsPanel />
        </div>
      )}
    </div>
  );
}
