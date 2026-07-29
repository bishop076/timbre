"use client";

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
