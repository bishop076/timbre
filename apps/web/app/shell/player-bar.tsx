"use client";

import { useState } from "react";

import { NextIcon, NoteIcon, PauseIcon, PlayIcon, PrevIcon, QueueIcon, SpinnerIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { QueuePanel } from "../player/queue-panel";
import { YouTubePlayer } from "../player/youtube-player";
import { sourceStyle } from "../sources";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * The persistent player bar.
 *
 * Hosts the real YouTube player rather than a facade over a hidden one:
 * YouTube's policies require the player to stay visible and forbid isolating
 * audio from video, so it sits here at a genuine 16:9 size, sized off the bar's
 * height so it cannot overflow.
 */
export function PlayerBar() {
  const { current, state, problem, queue, index, position, duration, toggle, next, previous, seek } =
    usePlayer();

  const [showQueue, setShowQueue] = useState(false);

  const busy = state === "resolving" || state === "loading";
  const playing = state === "playing";
  const hasNext = index + 1 < queue.length;
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)]">
      {showQueue && <QueuePanel onClose={() => setShowQueue(false)} />}

      {/* Progress sits flush along the top edge, full width, so it reads as
          part of the bar rather than a control competing with the buttons. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        onClick={(event) => {
          if (duration <= 0) return;
          const box = event.currentTarget.getBoundingClientRect();
          seek(((event.clientX - box.left) / box.width) * duration);
        }}
        onKeyDown={(event) => {
          if (duration <= 0) return;
          if (event.key === "ArrowRight") seek(Math.min(duration, position + 5));
          if (event.key === "ArrowLeft") seek(Math.max(0, position - 5));
        }}
        className="group relative h-1 w-full cursor-pointer bg-[var(--surface-hover)]"
      >
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-200 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex h-[4.5rem] items-center gap-3 px-3 sm:h-20 sm:gap-4 sm:px-6">
        <YouTubePlayer />

        {!current && (
          <div className="hidden size-12 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-hover)] text-[var(--muted)] sm:flex">
            <NoteIcon className="size-5" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {current ? (
            <>
              <p className="truncate text-sm font-medium">{current.title}</p>
              <p className="flex items-center gap-2 truncate text-xs text-[var(--muted)]">
                <span className="truncate">{current.artists.join(", ") || "Unknown artist"}</span>
                {state === "unplayable" ? (
                  <span className="shrink-0 text-amber-500">{problem ?? "Can't play this"}</span>
                ) : (
                  <span
                    className="hidden shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium sm:inline"
                    style={{
                      color: sourceStyle("ytmusic").color,
                      backgroundColor: sourceStyle("ytmusic").tint,
                    }}
                  >
                    {state === "resolving" ? "finding a copy…" : "YT Music"}
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-sm text-[var(--muted)]">Nothing playing</p>
              <p className="truncate text-xs text-[var(--muted)] opacity-70">
                Pick a song and it plays right here
              </p>
            </>
          )}
        </div>

        <span className="hidden shrink-0 font-mono text-xs tabular-nums text-[var(--muted)] md:block">
          {clock(position)} / {duration > 0 ? clock(duration) : "—:—"}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={previous}
            disabled={!current || index === 0}
            aria-label="Previous track"
            className="flex size-9 items-center justify-center rounded-full text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:text-[var(--muted)]"
          >
            <PrevIcon className="size-4.5" />
          </button>

          <button
            type="button"
            onClick={toggle}
            disabled={!current || state === "unplayable"}
            aria-label={playing ? "Pause" : "Play"}
            className="flex size-11 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] transition hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
          >
            {busy ? (
              <SpinnerIcon className="size-5 animate-spin" />
            ) : playing ? (
              <PauseIcon className="size-5" />
            ) : (
              <PlayIcon className="size-5 translate-x-px" />
            )}
          </button>

          <button
            type="button"
            onClick={next}
            disabled={!hasNext}
            aria-label="Next track"
            className="flex size-9 items-center justify-center rounded-full text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:text-[var(--muted)]"
          >
            <NextIcon className="size-4.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowQueue((open) => !open)}
            aria-label="Queue"
            aria-expanded={showQueue}
            className={`ml-1 hidden size-9 items-center justify-center rounded-full transition sm:flex ${
              showQueue
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <QueueIcon className="size-4.5" />
          </button>
        </div>
      </div>
    </footer>
  );
}
