"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration } from "../duration";

// A progress slider whose played portion is a travelling wave — a sine sampled as a
// polyline, with a flat line for the remainder. Phase advances with playback position
// rather than on a CSS animation, so there is no separate "is it animating" state to keep
// in sync with the player. The amplitude eases to zero at the handle.

const HEIGHT = 24;
const MID = HEIGHT / 2;
/** Wavelength and amplitude in user units; the viewBox is 100 wide. */
const WAVELENGTH = 7;
const AMPLITUDE = 3.2;
/** Sample step. Small enough to look smooth, large enough to keep the path short. */
const STEP = 0.7;

function wavePath(percent: number, phase: number): string {
  const end = Math.max(0, Math.min(100, percent));
  const points: string[] = [];

  for (let x = 0; x <= end; x += STEP) {
    const taper = Math.min(1, (end - x) / 6);
    const y = MID + Math.sin((x / WAVELENGTH) * Math.PI * 2 - phase) * AMPLITUDE * taper;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (points.length === 0) points.push(`0,${MID}`);

  return `M ${points.join(" L ")}`;
}

export function WavyProgress({
  percent,
  playing,
  className = "",
}: {
  percent: number;
  playing: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));

  const phase = playing ? (clamped / 100) * 42 : 0;

  return (
    <svg
      viewBox={`0 0 100 ${HEIGHT}`}
      preserveAspectRatio="none"
      // The fallback applies only when nothing is passed: two competing Tailwind height
      // classes resolve by stylesheet order rather than by intent.
      className={`w-full ${className || "h-6"}`}
      aria-hidden
    >
      {/* One opacity cannot serve both grounds: 0.28 is a faint track in a dark room and a
          drawn line across a pale one, so the palette sets it per ground. */}
      <line
        x1={clamped}
        y1={MID}
        x2="100"
        y2={MID}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ opacity: "var(--wave-rest, 0.28)" }}
        vectorEffect="non-scaling-stroke"
      />

      <path
        d={wavePath(clamped, phase)}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

    </svg>
  );
}

/** The scrub handle, deliberately **not** part of the SVG: `preserveAspectRatio="none"`
 * stretches the viewBox horizontally, turning any circle inside it into a resizing
 * ellipse, and `vectorEffect` fixes strokes, not fills. */
export function WavyHandle({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--ink)] bg-current"
      style={{ left: `${clamped}%` }}
    />
  );
}

// A position that advances every frame instead of twice a second. Neither embedded player
// pushes progress events, so `youtube-player.tsx` polls on a 500ms timer, and wired
// straight to the bar the wave lurched rather than travelled. The reported position
// becomes an *anchor* that rendering extrapolates from with a clock.
function useSmoothPosition(position: number, duration: number, playing: boolean): number {
  const [estimated, setEstimated] = useState(position);
  const anchor = useRef({ position, at: 0 });

  // Re-anchored during render, not in an effect, so the first frame after a report
  // extrapolates from it rather than from the previous one.
  if (anchor.current.position !== position) {
    anchor.current = { position, at: performance.now() };
  }

  // Anchored again whenever playback starts. The anchor's clock began at 0 — page load —
  // and `position` stays 0 from mount until the first poll, so the first frames of the first
  // song extrapolated from seconds-since-load and the wave flashed full. The same on resume:
  // time spent paused counted as time played until the next poll corrected it.
  useEffect(() => {
    if (playing) anchor.current = { position: anchor.current.position, at: performance.now() };
  }, [playing]);

  useEffect(() => {
    if (!playing) return;

    let frame = requestAnimationFrame(function tick() {
      const elapsed = (performance.now() - anchor.current.at) / 1000;
      const next = anchor.current.position + elapsed;
      setEstimated(duration > 0 ? Math.min(duration, next) : next);
      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  return playing ? estimated : position;
}

/** The seek control. Its own component so the per-frame smoothing above re-renders *this*
 * and nothing else — inline, every control in the bar would re-render sixty times a
 * second to animate one line. */
export function Scrub({
  position,
  duration,
  playing,
  onSeek,
  height = "h-6",
}: {
  position: number;
  duration: number;
  playing: boolean;
  onSeek: (seconds: number) => void;
  height?: string;
}) {
  const smooth = useSmoothPosition(position, duration, playing);
  const percent = duration > 0 ? (smooth / duration) * 100 : 0;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      // The reported position, not the interpolated one: a screen reader should hear where
      // the track is, not a per-frame estimate.
      aria-valuenow={Math.round(position)}
      // Without this a screen reader reads the raw number — "142" rather than "2:22 of
      // 4:19". `aria-valuenow` is seconds because the range has to be numeric; this is the
      // same value in the form a person uses.
      aria-valuetext={
        duration > 0
          ? `${formatDuration(position * 1000)} of ${formatDuration(duration * 1000)}`
          : "not playing"
      }
      onClick={(event) => {
        if (duration <= 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - box.left) / box.width) * duration);
      }}
      /*
       * `Home`, `End`, `PageUp` and `PageDown` are all scroll keys, and this slider is
       * focusable — so seeking with the keyboard also threw the panel behind it to the top,
       * to the bottom, or a page in either direction. Handling a key now consumes it.
       *
       * One decision rather than six independent `if`s, so a single place knows whether the
       * press was ours. Home and End are expected of any slider, and are the only way to
       * reach either end without holding an arrow down for the length of the track.
       */
      onKeyDown={(event) => {
        if (duration <= 0) return;

        const to =
          event.key === "ArrowRight"
            ? Math.min(duration, position + 5)
            : event.key === "ArrowLeft"
              ? Math.max(0, position - 5)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? duration
                  : event.key === "PageUp"
                    ? Math.min(duration, position + 30)
                    : event.key === "PageDown"
                      ? Math.max(0, position - 30)
                      : null;

        if (to === null) return;
        event.preventDefault();
        onSeek(to);
      }}
      // Taller than the visible line: 4px is impossible with a thumb.
      className={`tint group relative flex ${height} w-full cursor-pointer items-center text-[var(--accent)]`}
    >
      <WavyProgress percent={percent} playing={playing} className={height} />
      <WavyHandle percent={percent} />
    </div>
  );
}
