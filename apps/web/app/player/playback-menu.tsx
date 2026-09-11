"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

import { formatElapsed } from "../duration";
import { MoonIcon, SpeedIcon } from "../icons";
import { useAnchoredMenu } from "../playlists/use-anchored-menu";
import {
  formatSpeed,
  NORMAL_SPEED,
  SPEEDS,
  speedSupport,
  speedToApply,
  useSpeed,
  useYouTubeRates,
  writeSpeed,
} from "./playback-speed.ts";
import { usePlayerControls, usePlayerProgress } from "./player-context";
import {
  cancelSleepTimer,
  describeSleep,
  formatRemaining,
  SLEEP_MINUTES,
  sleepAtTrackEnd,
  startSleepTimer,
  trackSecondsLeft,
  useSleepSecondsLeft,
  useSleepTimer,
} from "./sleep-timer.ts";

const MENU_WIDTH = 256;

const HEADING = "text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]";

export function PlaybackMenu({ variant }: { variant: "bar" | "sheet" }) {
  const { activeSource, videoId, streamUrl, mixcloudKey, spotifyTrackId, subscriptionTrack } =
    usePlayerControls();
  const speed = useSpeed();
  const youtubeRates = useYouTubeRates();
  const timer = useSleepTimer();
  const seconds = useSleepSecondsLeft();

  const { open, setOpen, root, trigger, menu, placed, style } = useAnchoredMenu(
    timer.kind,
    MENU_WIDTH,
  );
  const speedHeading = useId();
  const sleepHeading = useId();

  const support = speedSupport({
    activeSource,
    videoId,
    streamUrl,
    mixcloudKey,
    spotifyTrackId,
    subscription: subscriptionTrack?.source ?? null,
    youtubeRates,
  });
  const playingAt = support.supported ? speedToApply(speed, support.speeds) : NORMAL_SPEED;
  const speedNote = !support.supported
    ? support.reason
    : playingAt !== speed
      ? `YouTube doesn't offer ${formatSpeed(speed)} for this video, so it plays at 1×.`
      : null;

  const sleepBlocked = subscriptionTrack
    ? `${subscriptionTrack.source === "apple" ? "Apple Music" : "Deezer"}'s player can't be paused from here.`
    : null;

  const sleeping = timer.kind !== "off";
  const changed = speed !== NORMAL_SPEED;

  useEffect(() => {
    if (placed && !menu.current?.contains(document.activeElement)) menu.current?.focus();
  }, [placed, menu]);

  const sheet = variant === "sheet";
  const status = describeSleep(timer, seconds);

  const label = [
    "Speed and sleep timer",
    changed ? `speed ${formatSpeed(speed)}` : null,
    sleeping ? "sleep timer on" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Speed and sleep timer"
        className={`press flex items-center justify-center gap-1 font-mono text-[11px] font-bold tabular-nums ${
          sheet
            ? "h-11 min-w-11 rounded-[var(--r-full)] px-2 transition"
            : "slab-sm h-8 min-w-8 rounded-[var(--r-md)] px-1.5"
        } ${changed || sleeping ? "tint text-[var(--accent)]" : sheet ? "text-[var(--fg-faint)]" : "text-[var(--fg)]"}`}
        style={sheet ? undefined : { background: "var(--surface-2)" }}
      >
        {changed && (
          <span className={playingAt === speed ? undefined : "text-[var(--fg-faint)]"}>
            {formatSpeed(speed)}
          </span>
        )}
        {sleeping && <MoonIcon className="size-4" />}
        {timer.kind === "timed" && seconds !== null && <span>{formatRemaining(seconds)}</span>}
        {!changed && !sleeping && <SpeedIcon className="size-[18px]" />}
      </button>

      {open &&
        createPortal(
          <div
            ref={menu}
            role="dialog"
            aria-label="Speed and sleep timer"
            tabIndex={-1}
            style={style}
            className="slab fixed z-[100] w-64 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)] outline-none"
          >
            <section aria-labelledby={speedHeading} className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 id={speedHeading} className={HEADING}>
                  Speed
                </h2>
                <button
                  type="button"
                  onClick={() => writeSpeed(NORMAL_SPEED)}
                  disabled={!changed}
                  aria-label="Reset speed to 1×"
                  className="rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--surface-2)] disabled:text-[var(--fg-faint)] disabled:hover:bg-transparent"
                >
                  Reset
                </button>
              </div>

              <div
                role="group"
                aria-label="Playback speed"
                aria-describedby={speedNote ? `${speedHeading}-note` : undefined}
                className="grid grid-cols-5 gap-1"
              >
                {SPEEDS.map((rate) => {
                  const offered = support.supported && support.speeds.includes(rate);
                  const chosen = speed === rate;
                  return (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => writeSpeed(rate)}
                      disabled={!offered}
                      aria-pressed={chosen}
                      title={
                        offered
                          ? undefined
                          : support.supported
                            ? "YouTube doesn't offer this speed for this video."
                            : support.reason
                      }
                      className={`press rounded-[var(--r-sm)] py-1.5 font-mono text-[12px] font-bold tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                        chosen ? "tint text-[var(--accent-fg)]" : "bg-[var(--surface-2)] text-[var(--fg)]"
                      }`}
                      style={chosen ? { background: "var(--accent)" } : undefined}
                    >
                      {formatSpeed(rate)}
                    </button>
                  );
                })}
              </div>

              {speedNote && (
                <p id={`${speedHeading}-note`} className="mt-2 text-[11px] leading-snug text-[var(--fg-faint)]">
                  {speedNote}
                </p>
              )}
            </section>

            <section
              aria-labelledby={sleepHeading}
              className="border-t-[length:var(--edge)] border-[var(--ink)] p-3"
            >
              <h2 id={sleepHeading} className={`${HEADING} mb-2`}>
                Sleep timer
              </h2>

              <div role="group" aria-label="Pause after" className="grid grid-cols-4 gap-1">
                {SLEEP_MINUTES.map((minutes) => {
                  const chosen = timer.kind === "timed" && timer.minutes === minutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => startSleepTimer(minutes)}
                      disabled={Boolean(sleepBlocked)}
                      aria-pressed={chosen}
                      aria-label={`Pause in ${minutes} minutes`}
                      title={sleepBlocked ?? undefined}
                      className={`press rounded-[var(--r-sm)] py-1.5 text-[12px] font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                        chosen ? "tint text-[var(--accent-fg)]" : "bg-[var(--surface-2)] text-[var(--fg)]"
                      }`}
                      style={chosen ? { background: "var(--accent)" } : undefined}
                    >
                      {minutes}m
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={sleepAtTrackEnd}
                  disabled={Boolean(sleepBlocked)}
                  aria-pressed={timer.kind === "track-end"}
                  title={sleepBlocked ?? undefined}
                  className={`press col-span-4 rounded-[var(--r-sm)] py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                    timer.kind === "track-end"
                      ? "tint text-[var(--accent-fg)]"
                      : "bg-[var(--surface-2)] text-[var(--fg)]"
                  }`}
                  style={timer.kind === "track-end" ? { background: "var(--accent)" } : undefined}
                >
                  End of this track
                </button>
              </div>

              {status && (
                <div className="mt-2.5 flex items-center gap-2">
                  <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-medium tabular-nums">
                    <MoonIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
                    <span className="truncate">
                      {status}
                      {timer.kind === "track-end" && <TrackLeft rate={playingAt} />}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={cancelSleepTimer}
                    aria-label="Cancel sleep timer"
                    className="press shrink-0 rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-semibold text-[var(--fg)]"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <p className="mt-2 text-[11px] leading-snug text-[var(--fg-faint)]">
                {sleepBlocked ?? "Kept in this tab only — closing or reloading it cancels the timer."}
              </p>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

function TrackLeft({ rate }: { rate: number }) {
  const { position, duration } = usePlayerProgress();
  const left = trackSecondsLeft(position, duration, rate);
  if (left === null) return null;
  return <span className="text-[var(--fg-dim)]"> · {formatElapsed(left, duration / rate)}</span>;
}
