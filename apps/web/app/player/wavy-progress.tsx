"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration } from "../duration";
import { usePlayer } from "./player-context";

const HEIGHT = 24;
const MID = HEIGHT / 2;
const WAVELENGTH = 7;
const AMPLITUDE = 3.2;
const STEP = 0.7;

const SEEK_KEYS = new Map([
  ["ArrowRight", 5],
  ["ArrowLeft", -5],
  ["PageUp", 30],
  ["PageDown", -30],
  ["Home", -Infinity],
  ["End", Infinity],
]);

function wavePath(end: number, phase: number): string {
  const points: string[] = [];
  for (let x = 0; x <= end; x += STEP) {
    const taper = Math.min(1, (end - x) / 6);
    const y = MID + Math.sin((x / WAVELENGTH) * Math.PI * 2 - phase) * AMPLITUDE * taper;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M ${points.join(" L ")}`;
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

export function Scrub({ height }: { height?: string }) {
  const { state, seek, position, duration } = usePlayer();

  return (
    <ScrubBar
      position={position}
      duration={duration}
      playing={state === "playing"}
      onSeek={seek}
      height={height}
    />
  );
}

export function ScrubBar({
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
  const raw = duration > 0 ? (smooth / duration) * 100 : 0;
  const percent = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
  const phase = playing ? (percent / 100) * 42 : 0;

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
        const step = SEEK_KEYS.get(event.key);
        if (duration <= 0 || step === undefined) return;
        event.preventDefault();
        onSeek(Math.max(0, Math.min(duration, position + step)));
      }}
      className={`tint group relative flex ${height} w-full cursor-pointer items-center text-[var(--accent)]`}
    >
      <svg
        viewBox={`0 0 100 ${HEIGHT}`}
        preserveAspectRatio="none"
        className={`w-full ${height}`}
        aria-hidden
      >
        <line
          x1={percent}
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
          d={wavePath(percent, phase)}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--ink)] bg-current"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}
