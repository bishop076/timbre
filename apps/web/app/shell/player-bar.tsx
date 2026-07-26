"use client";

import { NextIcon, NoteIcon, PlayIcon, PrevIcon } from "../icons";

/**
 * The persistent player bar.
 *
 * A placeholder until Phase B, but it exists now on purpose: it is where the
 * queue controller and the embedded players will live, and building the shell
 * around it first means the layout does not have to be rearranged later.
 *
 * When it is wired up, the YouTube iframe must be **visible** during playback
 * — YouTube's Developer Policies forbid hiding it — so this bar expands into a
 * player panel rather than staying a thin strip.
 */
export function PlayerBar() {
  return (
    <footer className="flex h-20 shrink-0 items-center gap-4 border-t border-[var(--border)] bg-[var(--surface)] px-4 lg:px-6">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-hover)] text-[var(--muted)]">
        <NoteIcon className="size-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--muted)]">Nothing playing</p>
        <p className="truncate text-xs text-[var(--muted)] opacity-70">
          Search for something and press play
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled
          aria-label="Previous track"
          className="flex size-9 items-center justify-center rounded-full text-[var(--muted)] transition disabled:opacity-30"
        >
          <PrevIcon className="size-4.5" />
        </button>
        <button
          type="button"
          disabled
          aria-label="Play"
          className="flex size-11 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] transition disabled:opacity-30"
        >
          <PlayIcon className="size-5" />
        </button>
        <button
          type="button"
          disabled
          aria-label="Next track"
          className="flex size-9 items-center justify-center rounded-full text-[var(--muted)] transition disabled:opacity-30"
        >
          <NextIcon className="size-4.5" />
        </button>
      </div>
    </footer>
  );
}
