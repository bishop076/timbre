"use client";

import { ArtistLink } from "../artist-link";
import { Artwork } from "../artwork";
import { formatElapsed } from "../duration";
import { Equalizer } from "../equalizer";
import {
  CollapseIcon,
  ExpandIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SpinnerIcon,
} from "../icons";
import { PlaybackMenu } from "../player/playback-menu";
import { usePlayerControls, usePlayerProgress } from "../player/player-context";
import { Volume } from "../player/volume";
import type { LeftYouTube } from "../player/youtube-refusal";
import { Scrub } from "../player/wavy-progress";
import { LikeButton } from "../playlists/like-button";
import { sourceStyle } from "../sources";
import { SourceLink } from "./source-link";

// Two different things send the ladder away from YouTube, and only one of them is the network.
// Saying "refused this connection" when an ad blocker ate the script sends people to their VPN.
const LEFT_YOUTUBE: Record<LeftYouTube, string> = {
  blocked: "YouTube's player is blocked here",
  refused: "YouTube refused this connection",
};

type Variant = "bar" | "sheet";

const REPEAT_LABELS = { off: "Repeat off", all: "Repeat queue", one: "Repeat one" };

export function ModeButton({ mode, variant }: { mode: "shuffle" | "repeat"; variant: Variant }) {
  const { shuffle, repeat, toggleShuffle, cycleRepeat } = usePlayerControls();
  const bar = variant === "bar";
  const on = mode === "shuffle" ? shuffle : repeat !== "off";
  const Icon = mode === "shuffle" ? ShuffleIcon : repeat === "one" ? RepeatOneIcon : RepeatIcon;

  return (
    <button
      type="button"
      onClick={mode === "shuffle" ? toggleShuffle : cycleRepeat}
      aria-label={mode === "shuffle" ? "Shuffle" : REPEAT_LABELS[repeat]}
      aria-pressed={on}
      className={`press flex items-center justify-center ${
        bar
          ? "relative size-8 rounded-[var(--r-md)] transition-colors"
          : "size-11 rounded-[var(--r-full)] transition"
      } ${
        on
          ? "tint text-[var(--accent)]"
          : `text-[var(--fg-faint)]${bar ? " hover:text-[var(--fg)]" : ""}`
      }`}
    >
      <Icon className="size-[18px]" />
      {bar && (
        <span
          className={`absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-current transition-opacity ${
            on ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </button>
  );
}

function PlayButton({ variant }: { variant: Variant }) {
  const { current, state, toggle } = usePlayerControls();
  const playing = state === "playing";
  const icon = variant === "bar" ? "size-5" : "size-7";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!current || state === "unplayable"}
      aria-label={playing ? "Pause" : "Play"}
      className={`slab press tint flex ${
        variant === "bar" ? "size-10 rounded-[var(--r-full)]" : "size-16 rounded-[var(--r-full)]"
      } items-center justify-center text-[var(--accent-fg)] disabled:opacity-40`}
      style={{ background: "var(--accent)" }}
    >
      {state === "resolving" || state === "loading" ? (
        <SpinnerIcon className={`${icon} animate-spin`} />
      ) : playing ? (
        <PauseIcon className={icon} />
      ) : (
        <PlayIcon className={`${icon} translate-x-px`} />
      )}
    </button>
  );
}

export function Transport({ variant }: { variant: Variant }) {
  const { current, index, hasNext, previous, next } = usePlayerControls();
  // The bar's skips are bare icons, not slabs. Three bordered pills in a row beside a bordered
  // play button was the toy-piano look the redesign is getting away from; the sheet keeps its
  // slabs, where they are the only chrome on a full-screen surface.
  const skip = `press flex items-center justify-center disabled:opacity-40 ${
    variant === "bar"
      ? "size-9 rounded-[var(--r-full)] text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)]"
      : "slab-sm h-12 w-16 rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)]"
  }`;
  const icon = variant === "bar" ? "size-[18px]" : "size-5";

  return (
    <>
      <button
        type="button"
        onClick={previous}
        disabled={!current || index === 0}
        aria-label="Previous track"
        className={skip}
      >
        <PrevIcon className={icon} />
      </button>
      <PlayButton variant={variant} />
      <button type="button" onClick={next} disabled={!hasNext} aria-label="Next track" className={skip}>
        <NextIcon className={icon} />
      </button>
    </>
  );
}

/**
 * A pane with its right column ruled off — the thing the button actually opens.
 *
 * It was a video camera, and a crossed-out video camera when closed, for a button that shows the
 * queue, the credits and the lyrics. Video is involved only when the source happens to be a
 * YouTube embed. A control should look like its effect.
 */
function QueuePanelIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 4.5v15" stroke="currentColor" strokeWidth="1.8" />
      {open ? (
        <path
          d="M17.2 9.6h1.6M17.2 12h1.6M17.2 14.4h1.6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function Elapsed() {
  const { position, duration } = usePlayerProgress();

  return (
    <span className="mr-1 hidden font-mono text-[11px] tabular-nums text-[var(--fg-faint)] xl:inline">
      {formatElapsed(position, duration)} /{" "}
      {duration > 0 ? formatElapsed(duration, duration) : "—:—"}
    </span>
  );
}

export function PlayerBar() {
  const {
    current,
    state,
    problem,
    playingPreview,
    youtubeTurnedAway,
    activeSource,
    subscriptionTrack,
    streamUrl,
    panelOpen,
    theater,
    togglePanel,
    toggleTheater,
  } = usePlayerControls();

  if (!current) return null;

  // Only the "show" version. When the panel is open there is nothing for this to do that the
  // panel's own edge does not already do better — you drag it away — and a second control that
  // flips between two meanings in the corner of the bar was the "too many buttons" complaint.
  // Closed, it is one button with one job.
  const panelButton = panelOpen ? null : (
    <button
      type="button"
      onClick={togglePanel}
      aria-label="Show now playing"
      title="Show now playing"
      className={`slab-sm press size-8 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg)] ${
        streamUrl ? "hidden xl:flex" : "flex"
      }`}
    >
      <QueuePanelIcon className="size-[18px]" open={false} />
    </button>
  );

  const artwork = (
    <Artwork src={current.artworkUrl} eager className="slab-sm size-11 shrink-0 rounded-[var(--r-md)]" />
  );

  const meta = (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-2 truncate text-sm font-medium">
        {state === "playing" && (
          <Equalizer className="tint h-3 shrink-0 gap-0.5 text-[var(--accent)]" />
        )}
        <span className="min-w-0 truncate">{current.title}</span>
      </p>
      <p className="flex items-center gap-2 truncate text-xs text-[var(--fg-dim)]">
        <ArtistLink artists={current.artists} className="min-w-0 truncate" />
        {state === "unplayable" ? (
          <span className="shrink-0 text-[var(--warn)]">{problem ?? "Can't play this"}</span>
        ) : subscriptionTrack ? (
          <span className="shrink-0 text-[var(--accent)]">
            press to start — full song if you&rsquo;re signed in
          </span>
        ) : (
          <SourceLink
            song={current}
            activeSource={activeSource}
            label={
              state === "resolving"
                ? "finding a copy…"
                : sourceStyle(activeSource ?? "ytmusic").short
            }
            className="hidden sm:inline"
          />
        )}
        {playingPreview && state !== "unplayable" && (
          <span className="shrink-0 text-[var(--warn)]">30-second preview</span>
        )}
        {youtubeTurnedAway && state !== "unplayable" && (
          <span className="min-w-0 truncate text-[var(--warn)]" title={LEFT_YOUTUBE[youtubeTurnedAway]}>
            · {LEFT_YOUTUBE[youtubeTurnedAway]}
          </span>
        )}
      </p>
    </div>
  );

  return (
    <>
      <footer className="shrink-0 border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] px-3 pb-2 pt-2.5 lg:hidden">
        <div className="mb-2 flex items-center gap-2">
          {artwork}
          {meta}
          {streamUrl ? (
            <button
              type="button"
              onClick={toggleTheater}
              aria-label="Open player"
              className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg)]"
            >
              <ExpandIcon className="size-[18px]" />
            </button>
          ) : (
            panelButton
          )}
          <PlayButton variant="bar" />
        </div>
        <Scrub />
      </footer>

      {/* Three columns, not three flex children: the transport sits on the bar's centre line
          whatever the track is called, which is how every player people already know does it.
          A flex row with `flex-1` on each side drifts as soon as the title is long. */}
      <footer className="relative hidden shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 bg-[var(--surface-1)] px-4 pb-[calc(0.5rem+var(--safe-b))] pt-2 lg:grid">
        <div className="absolute inset-x-0 -top-2 z-10 px-2">
          <Scrub height="h-4" />
        </div>

        {/* The heart belongs to the track, not to the transport. It was wedged between repeat
            and the volume group, four identical-weight glyphs in a row where three of them
            control playback and one changes your library — so it was easy to hit by accident and
            hard to find on purpose. Out here it sits beside the title it acts on, with space. */}
        <div className="flex min-w-0 items-center gap-3">
          {artwork}
          {meta}
          {current ? (
            <span className="ml-1 shrink-0">
              <LikeButton song={current} />
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-center">
          <div className="relative flex items-center gap-1.5">
            <ModeButton mode="shuffle" variant="bar" />
            <Transport variant="bar" />
            <ModeButton mode="repeat" variant="bar" />
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1.5">
          {/* Four controls, not seven. The speed menu and the theater toggle used to sit here as
              two more same-sized circles; both are things you reach for once a session, and both
              live in the now-playing panel, which is where you already are when you want them.
              What is left is the two things you read (elapsed, volume) and the one that opens the
              panel. */}
          <Elapsed />
          <Volume />
          {panelButton}
        </div>
      </footer>
    </>
  );
}
