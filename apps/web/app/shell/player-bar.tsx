"use client";

import { ArtistLink } from "../artist-link";
import { Artwork } from "../artwork";
import { formatElapsed } from "../duration";
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
import { usePlayer, type RepeatMode } from "../player/player-context";
import { Volume } from "../player/volume";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { LikeButton } from "../playlists/like-button";
import { Scrub } from "../player/wavy-progress";
import { sourceStyle } from "../sources";
import { SourceLink } from "./source-link";

export function ModeButton({
  label,
  on,
  onClick,
  icon,
  variant,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  variant: "bar" | "sheet";
}) {
  const bar = variant === "bar";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
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
      {icon}
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

export function repeatMode(repeat: RepeatMode): { label: string; icon: React.ReactNode } {
  return {
    label: repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat queue" : "Repeat off",
    icon:
      repeat === "one" ? (
        <RepeatOneIcon className="size-[18px]" />
      ) : (
        <RepeatIcon className="size-[18px]" />
      ),
  };
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
    index,
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
    hasNext,
    toggleShuffle,
    cycleRepeat,
  } = usePlayer();

  const busy = state === "resolving" || state === "loading";
  const playing = state === "playing";
  const source = sourceStyle(activeSource ?? "ytmusic");

  const audioOnly = Boolean(streamUrl);

  const panelButton = (
    <button
      type="button"
      onClick={togglePanel}
      disabled={!current}
      aria-label={panelOpen ? "Hide now playing" : "Show now playing"}
      aria-pressed={panelOpen}
      className={`slab-sm press size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--fg)] disabled:opacity-40 ${
        audioOnly ? "hidden xl:flex" : "flex"
      }`}
      style={{ background: panelOpen ? "var(--accent)" : "var(--surface-2)" }}
    >
      {panelOpen ? <VideoIcon className="size-[18px]" /> : <VideoOffIcon className="size-[18px]" />}
    </button>
  );

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

  const artwork = (size: string) => (
    <Artwork
      src={current?.artworkUrl}
      eager
      className={`slab-sm ${size} shrink-0 rounded-[var(--r-md)]`}
    />
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
                label={state === "resolving" ? "finding a copy…" : source.short}
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
      <footer className="shrink-0 border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] px-3 pb-2 pt-2.5 lg:hidden">
        <div className="mb-2 flex items-center gap-2">
          {artwork("size-11")}
          {meta}
          {panelButton}
          {playButton("size-10", "size-5")}
        </div>
        <Scrub position={position} duration={duration} playing={playing} onSeek={seek} />
      </footer>

      <footer className="relative hidden shrink-0 items-center gap-6 bg-[var(--surface-1)] px-4 pb-[calc(0.5rem+var(--safe-b))] pt-2 lg:flex">
        <div className="absolute inset-x-0 -top-2 z-10 px-2">
          <Scrub position={position} duration={duration} playing={playing} onSeek={seek} height="h-4" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {artwork("size-11")}
          {meta}
          {current && <LikeButton song={current} />}
          {current && <AddToPlaylist song={current} className="shrink-0" />}
        </div>

        <div className="flex shrink-0 items-center justify-center">
          <div className="relative flex items-center gap-2">
            <ModeButton
              variant="bar"
              label="Shuffle"
              on={shuffle}
              onClick={toggleShuffle}
              icon={<ShuffleIcon className="size-[18px]" />}
            />

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

            <ModeButton
              variant="bar"
              {...repeatMode(repeat)}
              on={repeat !== "off"}
              onClick={cycleRepeat}
            />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          <span className="mr-1 hidden font-mono text-[11px] tabular-nums text-[var(--fg-faint)] xl:inline">
            {formatElapsed(position, duration)} /{" "}
            {duration > 0 ? formatElapsed(duration, duration) : "—:—"}
          </span>
          <Volume />
          <PlaybackMenu variant="bar" />
          <span className="mx-1 h-6 w-px bg-[var(--line)]" />
          {theaterButton}
          {panelButton}
        </div>
      </footer>
    </>
  );
}
