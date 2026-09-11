"use client";

import { ArtistLink } from "../artist-link";
import { Artwork } from "../artwork";
import { formatElapsed } from "../duration";
import { NextIcon, PauseIcon, PlayHereIcon, PlayIcon, PrevIcon, SpinnerIcon } from "../icons";
import type { RemotePlayer } from "./tab-sync";
import { commandRemote, takeOverRemote } from "./use-tab-sync";
import { ScrubBar } from "./wavy-progress";

export function RemoteBar({ remote }: { remote: RemotePlayer }) {
  const { song, state, position, duration, hasNext, hasPrevious } = remote.report;
  const playing = state === "playing";
  const busy = state === "resolving" || state === "loading";
  const verb = state === "unplayable" ? "Stuck" : playing || busy ? "Playing" : "Paused";

  const seek = (seconds: number) => commandRemote({ action: "seek", seconds });

  const artwork = (
    <Artwork src={song.artworkUrl} eager className="slab-sm size-11 shrink-0 rounded-[var(--r-md)]" />
  );

  const meta = (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-2 truncate text-sm font-medium">
        {playing && (
          <span aria-hidden className="eq tint flex h-3 shrink-0 items-end gap-0.5 text-[var(--accent)]">
            <span />
            <span />
            <span />
          </span>
        )}
        <span className="min-w-0 truncate">{song.title}</span>
      </p>
      <p className="flex items-center gap-2 truncate text-xs text-[var(--fg-dim)]">
        <ArtistLink artists={song.artists} className="min-w-0 truncate" />
        <span className={`shrink-0 ${state === "unplayable" ? "text-amber-500" : "text-[var(--accent)]"}`}>
          <span className="hidden sm:inline">{verb} in</span>
          <span className="sm:hidden">{state === "unplayable" ? "Stuck in" : "In"}</span> another tab
        </span>
      </p>
    </div>
  );

  const playButton = (
    <button
      type="button"
      onClick={() => commandRemote({ action: "toggle" })}
      disabled={state === "unplayable"}
      aria-label={playing ? "Pause in the other tab" : "Play in the other tab"}
      className="slab press tint flex size-10 items-center justify-center rounded-[var(--r-lg)] text-[var(--accent-fg)] disabled:opacity-40"
      style={{ background: "var(--accent)" }}
    >
      {busy ? (
        <SpinnerIcon className="size-5 animate-spin" />
      ) : playing ? (
        <PauseIcon className="size-5" />
      ) : (
        <PlayIcon className="size-5 translate-x-px" />
      )}
    </button>
  );

  const skipButton = (direction: "previous" | "next", className = "") => (
    <button
      type="button"
      onClick={() => commandRemote({ action: direction })}
      disabled={direction === "next" ? !hasNext : !hasPrevious}
      aria-label={direction === "next" ? "Next track" : "Previous track"}
      className={`slab-sm press h-9 w-12 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40 ${
        className || "flex"
      }`}
    >
      {direction === "next" ? <NextIcon className="size-[18px]" /> : <PrevIcon className="size-[18px]" />}
    </button>
  );

  const playHere = (
    <button
      type="button"
      onClick={takeOverRemote}
      aria-label="Play here"
      title="Move playback to this tab"
      className="slab-sm press flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--surface-2)] px-2 text-xs font-medium text-[var(--fg)] sm:px-2.5"
    >
      <PlayHereIcon className="size-[18px]" />
      <span className="hidden sm:inline">Play here</span>
    </button>
  );

  return (
    <>
      <footer className="shrink-0 border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] px-3 pb-2 pt-2.5 lg:hidden">
        <div className="mb-2 flex items-center gap-2">
          {artwork}
          {meta}
          {playHere}
          {skipButton("previous", "hidden sm:flex")}
          {playButton}
          {skipButton("next")}
        </div>
        <ScrubBar position={position} duration={duration} playing={playing} onSeek={seek} />
      </footer>

      <footer className="relative hidden shrink-0 items-center gap-6 bg-[var(--surface-1)] px-4 pb-[calc(0.5rem+var(--safe-b))] pt-2 lg:flex">
        <div className="absolute inset-x-0 -top-2 z-10 px-2">
          <ScrubBar position={position} duration={duration} playing={playing} onSeek={seek} height="h-4" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {artwork}
          {meta}
        </div>

        <div className="flex shrink-0 items-center justify-center gap-2">
          {skipButton("previous")}
          {playButton}
          {skipButton("next")}
        </div>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          <span className="mr-1 hidden font-mono text-[11px] tabular-nums text-[var(--fg-faint)] xl:inline">
            {formatElapsed(position, duration)} /{" "}
            {duration > 0 ? formatElapsed(duration, duration) : "—:—"}
          </span>
          {playHere}
        </div>
      </footer>
    </>
  );
}
