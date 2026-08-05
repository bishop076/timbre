"use client";

import {
  CollapseIcon,
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
    <div className="flex shrink-0 flex-col gap-3 px-4 pb-3 pt-3">
      {/* Title and artist, with the collapse affordance opposite. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold leading-tight">
            {current?.title ?? "Nothing playing"}
          </p>
          <p className="truncate text-sm text-[var(--fg-dim)]">
            {current?.artists.join(", ") || "Unknown artist"}
          </p>
        </div>

        {current && <AddToPlaylist song={current} className="shrink-0" />}

        <button
          type="button"
          onClick={toggleTheater}
          aria-label="Collapse player"
          className="press flex size-9 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)]"
        >
          <CollapseIcon className="size-[18px]" />
        </button>
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

      {/* Modes, smaller and set apart — they change how the queue behaves
          rather than acting on it now. */}
      <div className="flex items-center justify-center gap-6">
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
      </div>
    </div>
  );
}
