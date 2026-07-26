"use client";

import { NextIcon, NoteIcon, PauseIcon, PlayIcon, PrevIcon, SpinnerIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { YouTubePlayer } from "../player/youtube-player";
import { sourceStyle } from "../sources";

/**
 * The persistent player bar.
 *
 * Hosts the real YouTube player rather than a facade over a hidden one:
 * YouTube's policies require the player to stay visible and forbid isolating
 * audio from video, so it sits here at a small but genuine 16:9 size.
 */
export function PlayerBar() {
  const { current, state, problem, queue, index, toggle, next, previous } = usePlayer();

  const busy = state === "resolving" || state === "loading";
  const playing = state === "playing";
  const hasNext = index + 1 < queue.length;

  return (
    <footer className="flex h-20 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-3 sm:gap-4 sm:px-6">
      <YouTubePlayer />

      {!current && (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-hover)] text-[var(--muted)]">
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
                  className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium"
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

      <div className="flex shrink-0 items-center gap-1">
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
      </div>
    </footer>
  );
}
