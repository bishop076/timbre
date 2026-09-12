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
  VideoIcon,
  VideoOffIcon,
} from "../icons";
import { PlaybackMenu } from "../player/playback-menu";
import { usePlayerControls, usePlayerProgress } from "../player/player-context";
import { Volume } from "../player/volume";
import { Scrub } from "../player/wavy-progress";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { LikeButton } from "../playlists/like-button";
import { sourceStyle } from "../sources";
import { SourceLink } from "./source-link";

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
        variant === "bar" ? "size-10 rounded-[var(--r-lg)]" : "size-16 rounded-[var(--r-full)]"
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
  const skip = `slab-sm press flex ${variant === "bar" ? "h-9 w-12" : "h-12 w-16"} items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] disabled:opacity-40`;
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

  const panelButton = (
    <button
      type="button"
      onClick={togglePanel}
      aria-label={panelOpen ? "Hide now playing" : "Show now playing"}
      aria-pressed={panelOpen}
      className={`slab-sm press size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)] ${
        streamUrl ? "hidden xl:flex" : "flex"
      }`}
      style={{ background: panelOpen ? "var(--accent)" : "var(--surface-2)" }}
    >
      {panelOpen ? <VideoIcon className="size-[18px]" /> : <VideoOffIcon className="size-[18px]" />}
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
          <span className="shrink-0 text-amber-500">{problem ?? "Can't play this"}</span>
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
          <span className="shrink-0 text-amber-500">30-second preview</span>
        )}
        {youtubeTurnedAway && state !== "unplayable" && (
          <span className="min-w-0 truncate text-amber-500" title="YouTube refused this connection">
            · YouTube refused this connection
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

      <footer className="relative hidden shrink-0 items-center gap-6 bg-[var(--surface-1)] px-4 pb-[calc(0.5rem+var(--safe-b))] pt-2 lg:flex">
        <div className="absolute inset-x-0 -top-2 z-10 px-2">
          <Scrub height="h-4" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {artwork}
          {meta}
          <LikeButton song={current} />
          <AddToPlaylist song={current} className="shrink-0" />
        </div>

        <div className="flex shrink-0 items-center justify-center">
          <div className="relative flex items-center gap-2">
            <ModeButton mode="shuffle" variant="bar" />
            <Transport variant="bar" />
            <ModeButton mode="repeat" variant="bar" />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          <Elapsed />
          <Volume />
          <PlaybackMenu variant="bar" />
          <span className="mx-1 h-6 w-px bg-[var(--line)]" />
          <button
            type="button"
            onClick={toggleTheater}
            aria-label={theater ? "Shrink video" : "Expand video"}
            aria-pressed={theater}
            className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)]"
            style={{ background: theater ? "var(--accent)" : "var(--surface-2)" }}
          >
            {theater ? <CollapseIcon className="size-[18px]" /> : <ExpandIcon className="size-[18px]" />}
          </button>
          {panelButton}
        </div>
      </footer>
    </>
  );
}
