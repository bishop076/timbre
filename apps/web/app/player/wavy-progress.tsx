"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration } from "../duration";

const HEIGHT = 24;
const MID = HEIGHT / 2;
const WAVELENGTH = 7;
const AMPLITUDE = 3.2;
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
      className={`w-full ${className || "h-6"}`}
      aria-hidden
    >
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

function useSmoothPosition(position: number, duration: number, playing: boolean): number {
  const [estimated, setEstimated] = useState(position);
  const anchor = useRef({ position, at: 0 });

  if (anchor.current.position !== position) {
    anchor.current = { position, at: performance.now() };
  }

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
      aria-valuenow={Math.round(position)}
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
      className={`tint group relative flex ${height} w-full cursor-pointer items-center text-[var(--accent)]`}
    >
      <WavyProgress percent={percent} playing={playing} className={height} />
      <WavyHandle percent={percent} />
    </div>
  );
}
