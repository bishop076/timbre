"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A progress slider whose played portion is a travelling wave.
 *
 * The idea comes from Material 3's expressive slider, by way of PixelPlayer.
 * It reads instantly as "this is moving" in a way a straight bar never does,
 * and it costs one SVG path.
 *
 * **How the wave is built.** The played span is a sine sampled at fixed
 * intervals and emitted as a polyline; the remaining span is a flat line. Both
 * live in one `<path>` so the join is exact and there is no seam at the handle.
 * The wave's phase advances with playback position rather than on a CSS
 * animation, so it travels while playing and holds still when paused — no
 * separate "is it animating" state to keep in sync with the player.
 *
 * The amplitude eases to zero over the last few percent so the wave settles
 * into the flat remainder instead of ending on an abrupt vertical step.
 */

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
    // Fade the wave out as it approaches the handle so it meets the flat
    // remainder smoothly rather than at a step.
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

  // Phase is derived from position, so the wave only travels while the track
  // does. Paused playback holds the waveform still, which is the correct read.
  const phase = playing ? (clamped / 100) * 42 : 0;

  return (
    <svg
      viewBox={`0 0 100 ${HEIGHT}`}
      preserveAspectRatio="none"
      // Height is overridable, and the fallback is only used when nothing is
      // passed — two competing Tailwind height classes would otherwise resolve
      // by stylesheet order rather than by intent.
      className={`w-full ${className || "h-6"}`}
      aria-hidden
    >
      {/* Remaining — a flat rule at low opacity. */}
      <line
        x1={clamped}
        y1={MID}
        x2="100"
        y2={MID}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.28"
        vectorEffect="non-scaling-stroke"
      />

      {/* Played — the wave. */}
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

/**
 * The scrub handle.
 *
 * Deliberately **not** part of the SVG. `preserveAspectRatio="none"` stretches
 * the viewBox horizontally to fill whatever width the bar has, which turns any
 * circle drawn inside it into an ellipse that changes shape as the window
 * resizes. `vectorEffect` fixes strokes, not fills. An absolutely positioned
 * element sidesteps the whole problem and stays perfectly round.
 */
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

/**
 * A position that advances every frame instead of twice a second.
 *
 * Neither embedded player pushes progress events, so the only way to know where
 * a track is, is to ask — and `youtube-player.tsx` asks on a 500ms timer. Wired
 * straight to the bar that produced two visible steps a second: the wave and
 * handle lurched rather than travelled.
 *
 * So the reported position becomes an *anchor* — a value and the moment it
 * arrived — and rendering extrapolates from it with a clock. Playback runs at
 * exactly one second per second, so the estimate between polls is not a guess;
 * each poll simply re-anchors it, and any correction is the few milliseconds
 * the timer drifted.
 *
 * Paused, it reports the anchor unchanged, so nothing creeps forward while the
 * track is stopped. A seek moves the anchor, which lands immediately — a jump
 * there is the correct reading, not a glitch.
 */
function useSmoothPosition(position: number, duration: number, playing: boolean): number {
  const [estimated, setEstimated] = useState(position);
  const anchor = useRef({ position, at: 0 });

  // Re-anchor whenever the player reports a new position, including a seek.
  // Derived during render rather than in an effect so the first frame after a
  // report already extrapolates from it instead of from the previous anchor.
  if (anchor.current.position !== position) {
    anchor.current = { position, at: performance.now() };
  }

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

  // Paused, the reported value is the truth and nothing should creep forward.
  return playing ? estimated : position;
}

/**
 * The seek control.
 *
 * A component rather than a fragment of the player bar specifically so the
 * per-frame smoothing above re-renders *this* and nothing else. Left inline,
 * every control in the bar would re-render sixty times a second to animate one
 * line.
 */
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
      // Announced from the reported position, not the interpolated one: a
      // screen reader should hear where the track is, not a per-frame estimate.
      aria-valuenow={Math.round(position)}
      onClick={(event) => {
        if (duration <= 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - box.left) / box.width) * duration);
      }}
      onKeyDown={(event) => {
        if (duration <= 0) return;
        if (event.key === "ArrowRight") onSeek(Math.min(duration, position + 5));
        if (event.key === "ArrowLeft") onSeek(Math.max(0, position - 5));
      }}
      // The hit area is deliberately taller than the visible line: a 4px target
      // is unusable with a mouse and impossible with a thumb.
      className={`tint group relative flex ${height} w-full cursor-pointer items-center text-[var(--accent)]`}
    >
      <WavyProgress percent={percent} playing={playing} className={height} />
      <WavyHandle percent={percent} />
    </div>
  );
}
