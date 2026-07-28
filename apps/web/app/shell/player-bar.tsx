"use client";

import {
  CollapseIcon,
  ExpandIcon,
  NextIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  SpinnerIcon,
  VideoIcon,
  VideoOffIcon,
} from "../icons";
import { usePlayer } from "../player/player-context";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { Volume } from "../player/volume";
import { WavyHandle, WavyProgress } from "../player/wavy-progress";
import { sourceStyle } from "../sources";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * The persistent player.
 *
 * Three zones on desktop — what is playing, how to control it, everything else
 * — so the transport stays optically centred no matter how long a title runs.
 * A two-zone bar puts the buttons wherever the title ends, which moves them
 * every track.
 *
 * On a phone it collapses to a mini bar: artwork, title, one play button. The
 * scrub track stays, because knowing where you are in a song matters more than
 * being able to skip precisely.
 *
 * This component also **owns the app's accent colour**, recolouring everything
 * from the current artwork. It lives here because the player bar is the one
 * component that is always mounted and always knows the current track.
 */
export function PlayerBar() {
  const {
    current,
    state,
    problem,
    activeSource,
    panelOpen,
    theater,
    queue,
    index,
    position,
    duration,
    toggle,
    next,
    previous,
    seek,
    togglePanel,
    toggleTheater,
  } = usePlayer();

  useArtworkAccent(current?.artworkUrl);

  const busy = state === "resolving" || state === "loading";
  const playing = state === "playing";
  const hasNext = index + 1 < queue.length;
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const source = sourceStyle(activeSource ?? "ytmusic");

  /**
   * Shows or hides the now-playing panel — the video, the track, what's next.
   *
   * Lives here rather than on the video itself so the transport never moves:
   * one row of controls, in one place, whether the current track has pictures
   * or not. Hiding only clips the panel — the player keeps its size, because
   * shrinking it below 200×200 stops YouTube playback outright.
   */
  const panelButton = (
    <button
      type="button"
      onClick={togglePanel}
      disabled={!current}
      aria-label={panelOpen ? "Hide now playing" : "Show now playing"}
      aria-pressed={panelOpen}
      className="slab-sm press flex size-9 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)] disabled:opacity-40"
      style={{ background: panelOpen ? "var(--accent)" : "var(--surface-2)" }}
    >
      {panelOpen ? <VideoIcon className="size-[18px]" /> : <VideoOffIcon className="size-[18px]" />}
    </button>
  );

  /**
   * The same thing clicking the picture does, offered where the rest of the
   * controls are — because a click target with no marking on it is not
   * discoverable, and this is the only one in the app.
   */
  const theaterButton = (
    <button
      type="button"
      onClick={toggleTheater}
      disabled={!current}
      aria-label={theater ? "Shrink video" : "Expand video"}
      aria-pressed={theater}
      className="slab-sm press flex size-9 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)] disabled:opacity-40"
      style={{ background: theater ? "var(--accent)" : "var(--surface-2)" }}
    >
      {theater ? <CollapseIcon className="size-[18px]" /> : <ExpandIcon className="size-[18px]" />}
    </button>
  );

  const scrub = (
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
      // The hit area is deliberately taller than the visible line: a 4px
      // target is unusable with a mouse and impossible with a thumb.
      className="tint group relative flex h-6 w-full cursor-pointer items-center text-[var(--accent)]"
    >
      <WavyProgress percent={progress} playing={playing} />
      <WavyHandle percent={progress} />
    </div>
  );

  const artwork = (size: string) => (
    <div
      className={`slab-sm ${size} shrink-0 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg-faint)]`}
    >
      {current?.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
        <img src={current.artworkUrl} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center">
          <NoteIcon className="size-5" />
        </span>
      )}
    </div>
  );

  const meta = (
    <div className="min-w-0 flex-1">
      {current ? (
        <>
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {playing && (
              <span aria-hidden className="eq tint flex h-3 shrink-0 items-end gap-0.5 text-[var(--accent)]">
                <span />
                <span />
                <span />
              </span>
            )}
            <span className="truncate">{current.title}</span>
          </p>
          <p className="flex items-center gap-2 truncate text-xs text-[var(--fg-dim)]">
            <span className="truncate">{current.artists.join(", ") || "Unknown artist"}</span>
            {state === "unplayable" ? (
              <span className="shrink-0 text-amber-500">{problem ?? "Can't play this"}</span>
            ) : (
              // Attribution names the source actually playing, never a
              // hardcoded one — a terms requirement for every service Timbre
              // embeds, and the only way a listener can tell whose player they
              // are hearing.
              <span
                className="hidden shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium sm:inline"
                style={{ color: source.color, backgroundColor: source.tint }}
              >
                {state === "resolving" ? "finding a copy…" : source.short}
              </span>
            )}
          </p>
        </>
      ) : (
        <>
          <p className="truncate text-sm text-[var(--fg-dim)]">Nothing playing</p>
          <p className="truncate text-xs text-[var(--fg-faint)]">
            Pick a song and it plays right here
          </p>
        </>
      )}
    </div>
  );

  const playButton = (size: string, icon: string) => (
    <button
      type="button"
      onClick={toggle}
      disabled={!current || state === "unplayable"}
      aria-label={playing ? "Pause" : "Play"}
      className={`slab press tint flex ${size} items-center justify-center rounded-[var(--r-lg)] text-[var(--accent-fg)] disabled:opacity-40`}
      style={{ background: "var(--accent)" }}
    >
      {busy ? (
        <SpinnerIcon className={`${icon} animate-spin`} />
      ) : playing ? (
        <PauseIcon className={icon} />
      ) : (
        <PlayIcon className={`${icon} translate-x-px`} />
      )}
    </button>
  );

  return (
    <>
      {/* ── Mobile: mini player, stacked directly on the bottom nav ────────── */}
      <footer className="shrink-0 border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] px-3 pb-2 pt-2.5 lg:hidden">
        <div className="mb-2 flex items-center gap-2">
          {artwork("size-11")}
          {meta}
          {panelButton}
          {playButton("size-10", "size-5")}
        </div>
        {scrub}
      </footer>

      {/* ── Desktop: three zones ───────────────────────────────────────────── */}
      <footer className="hidden shrink-0 items-center gap-6 border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] px-4 py-3 lg:flex">
        {/* Left — what is playing */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {artwork("size-14")}
          {meta}
        </div>

        {/* Centre — transport. Capped so it stays put as titles change, but the
            cap has to give way on a smaller desktop: a fixed 34rem centre left
            the two side zones about 240px each, which truncated most titles to
            a couple of words. */}
        <div className="flex w-full max-w-[22rem] shrink-0 flex-col items-center gap-1.5 xl:max-w-[34rem]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={previous}
              disabled={!current || index === 0}
              aria-label="Previous track"
              className="slab-sm press flex h-10 w-14 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40"
            >
              <PrevIcon className="size-[18px]" />
            </button>

            {playButton("size-11", "size-5")}

            <button
              type="button"
              onClick={next}
              disabled={!hasNext}
              aria-label="Next track"
              className="slab-sm press flex h-10 w-14 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40"
            >
              <NextIcon className="size-[18px]" />
            </button>
          </div>

          <div className="flex w-full items-center gap-2.5">
            <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--fg-faint)]">
              {clock(position)}
            </span>
            {scrub}
            <span className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-[var(--fg-faint)]">
              {duration > 0 ? clock(duration) : "—:—"}
            </span>
          </div>
        </div>

        {/* Right — everything else. Balances the left zone so the transport
            sits optically centred rather than merely mathematically. */}
        <div className="flex flex-1 items-center justify-end gap-1.5">
          <Volume />
          <span className="mx-1 h-6 w-px bg-[var(--line)]" />
          {theaterButton}
          {panelButton}
        </div>
      </footer>
    </>
  );
}
