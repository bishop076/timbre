"use client";

import {
  CollapseIcon,
  ExpandIcon,
  NextIcon,
  NoteIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SpinnerIcon,
  VideoIcon,
  VideoOffIcon,
} from "../icons";
import { usePlayer } from "../player/player-context";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { Volume } from "../player/volume";
import { Scrub } from "../player/wavy-progress";
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
    radio,
    position,
    duration,
    toggle,
    next,
    previous,
    seek,
    togglePanel,
    toggleTheater,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
  } = usePlayer();

  useArtworkAccent(current?.artworkUrl);

  const busy = state === "resolving" || state === "loading";
  const playing = state === "playing";
  // Next is live whenever anything *can* follow: the rest of the queue, a
  // repeat that will wrap, or a blend waiting to be stepped into.
  const hasNext = index + 1 < queue.length || repeat !== "off" || radio.length > 0;
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
      className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)] disabled:opacity-40"
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
      className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)] disabled:opacity-40"
      style={{ background: theater ? "var(--accent)" : "var(--surface-2)" }}
    >
      {theater ? <CollapseIcon className="size-[18px]" /> : <ExpandIcon className="size-[18px]" />}
    </button>
  );

  /**
   * Shuffle and repeat flank the transport, as they do in every player.
   *
   * They are drawn as plain tinted icons rather than as slabs: the three
   * central buttons are the transport, and giving a mode toggle the same
   * physical weight as Play would misstate what it does. Colour carries "on",
   * which is the only state that needs announcing.
   */
  const modeButton = (
    label: string,
    on: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={`press relative flex size-8 items-center justify-center rounded-[var(--r-md)] transition-colors ${
        on ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)] hover:text-[var(--fg)]"
      }`}
    >
      {icon}
      {/* A dot under an active mode. The accent is recoloured from the artwork,
          so on some covers colour alone is too quiet to read at a glance. */}
      <span
        className={`absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current transition-opacity ${
          on ? "opacity-100" : "opacity-0"
        }`}
      />
    </button>
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
        <Scrub position={position} duration={duration} playing={playing} onSeek={seek} />
      </footer>

      {/* ── Desktop: three zones ───────────────────────────────────────────── */}
      {/*
        One row, with the scrub on the top edge.

        It used to be two stacked rows — transport above, scrub below — which is
        Spotify's shape and cost 100px of a 900px window for four controls and a
        line. Moving the scrub onto the border turns the divider itself into the
        progress indicator, which is what YouTube Music does, and halves the
        height without dropping a single control.
      */}
      <footer className="relative hidden shrink-0 items-center gap-6 border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] px-4 py-2 lg:flex">
        {/* Straddles the top border, so the seek line *is* the divider. */}
        <div className="absolute inset-x-0 -top-2 z-10 px-2">
          <Scrub position={position} duration={duration} playing={playing} onSeek={seek} height="h-4" />
        </div>

        {/* Left — what is playing */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {artwork("size-11")}
          {meta}
        </div>

        {/* Centre — transport, now the only thing in this zone. */}
        <div className="flex shrink-0 items-center justify-center">
          <div className="relative flex items-center gap-2">
            {modeButton("Shuffle", shuffle, toggleShuffle, <ShuffleIcon className="size-[18px]" />)}

            <button
              type="button"
              onClick={previous}
              disabled={!current || index === 0}
              aria-label="Previous track"
              className="slab-sm press flex h-9 w-12 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40"
            >
              <PrevIcon className="size-[18px]" />
            </button>

            {playButton("size-10", "size-5")}

            <button
              type="button"
              onClick={next}
              disabled={!hasNext}
              aria-label="Next track"
              className="slab-sm press flex h-9 w-12 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40"
            >
              <NextIcon className="size-[18px]" />
            </button>

            {modeButton(
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

        {/* Right — everything else. Balances the left zone so the transport
            sits optically centred rather than merely mathematically. */}
        <div className="flex flex-1 items-center justify-end gap-1.5">
          {/* The times move here now that the scrub is on the border. Elapsed
              and total in one label rather than flanking a bar that no longer
              sits between them. */}
          <span className="mr-1 hidden font-mono text-[11px] tabular-nums text-[var(--fg-faint)] xl:inline">
            {clock(position)} / {duration > 0 ? clock(duration) : "—:—"}
          </span>
          <Volume />
          <span className="mx-1 h-6 w-px bg-[var(--line)]" />
          {theaterButton}
          {panelButton}
        </div>
      </footer>
    </>
  );
}
