"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChartTrack } from "@/lib/discover";

/*
 * Dots rather than bars: the popularity scores sit in a narrow band near the top of their
 * range (roughly 600k–999k of a million), and a bar must grow from zero or its length
 * lies. A dot has none, so its scale can start where the data does.
 */

/** Plot chrome, in pixels. Left is wide enough for a `1.0M` tick. */
const PAD = { left: 42, right: 14, top: 14, bottom: 20 };

/** The tooltip's widest. The only statement of it — it used to be here *and* as a
 * `max-w-[15rem]` class on the box, kept in step by hand, with the clamp below trusting
 * this copy to describe the other one. */
const TIP_MAX_W = 240;

// Between render and paint: after paint the first frame is an empty box and the view
// flickers. `useEffect` on the server, where React warns the other is useless.
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

function formatScore(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function scale(values: number[]): { min: number; max: number; ticks: number[] } {
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A step that produces four-ish gridlines, snapped to 1/2/5 × a power of ten.
  const rough = Math.max((high - low) / 3, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= rough) ?? magnitude * 10;

  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;

  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(value);
  return { min, max, ticks };
}

export function ChartGraph({
  tracks,
  onPick,
  height = 172,
}: {
  tracks: ChartTrack[];
  onPick?: (track: ChartTrack) => void;
  /** Set by the caller when this plot has to line up with another chart. */
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  // Measured, not a viewBox — scaling an SVG scales its text, so a 12px label hits 6px.
  useMeasure(() => {
    const element = box.current;
    if (!element) return;

    // Read up front: the observer fires on observe, but only next frame — the empty one.
    setWidth(element.clientWidth);

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = tracks.filter((track) => track.popularity > 0);

  // Below two points this is a single dot on an invented axis.
  if (points.length < 2) return <div ref={box} />;

  const { min, max, ticks } = scale(points.map((track) => track.popularity));
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    PAD.top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;

  // Smaller dots when they would touch. The 2px surface ring never shrinks.
  const gap = plotWidth / Math.max(1, points.length - 1);
  const radius = gap < 14 ? 3.5 : 4.5;

  const active = hover !== null ? points[hover] : null;

  return (
    // Height reserved: until a width is measured the box is zero-tall, and the card around
    // it sprang open on paint and on every click of the rail.
    <div ref={box} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Popularity score of the top ${points.length} songs, from ${formatScore(
            min,
          )} to ${formatScore(max)}. Every value is listed below.`}
          className="block touch-pan-y"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const offset = event.clientX - bounds.left - PAD.left;
            // Nearest point, not a hit on the dot itself — a 9px target is too small.
            const index = Math.round((offset / (plotWidth || 1)) * (points.length - 1));
            setHover(Math.min(points.length - 1, Math.max(0, index)));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              {/* Solid hairlines — dashes read as a threshold rather than a grid. */}
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-[var(--fg-faint)] text-[10px] tabular-nums"
              >
                {formatScore(tick)}
              </text>
            </g>
          ))}

          {/* The hovered position marked on the plot, so it is clear which dot the tooltip means. */}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              stroke="var(--fg-faint)"
              strokeWidth={1}
            />
          )}

          {points.map((track, index) => {
            const focused = hover === index;
            return (
              <circle
                key={track.id}
                cx={x(index)}
                cy={y(track.popularity)}
                r={focused ? radius + 1.5 : radius}
                fill="var(--accent)"
                stroke="var(--surface-1)"
                strokeWidth={2}
                onClick={() => onPick?.(track)}
                className={onPick ? "cursor-pointer" : undefined}
              />
            );
          })}

          {/* Only the ends are labelled — a number under every dot is unreadable. */}
          <text
            x={PAD.left}
            y={height - 5}
            textAnchor="start"
            className="fill-[var(--fg-faint)] text-[10px] tabular-nums"
          >
            #1
          </text>
          <text
            x={width - PAD.right}
            y={height - 5}
            textAnchor="end"
            className="fill-[var(--fg-faint)] text-[10px] tabular-nums"
          >
            #{points.length}
          </text>
        </svg>
      )}

      {active && (
        <div
          className="slab pointer-events-none absolute z-20 rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-2 shadow-[var(--drop-lg)]"
          style={{
            // The plot is the tighter limit on a narrow phone, and the `left` clamp below
            // has always assumed the box would honour it: once the chart is under 240px
            // there is nowhere left to slide to, so a box still 240px wide simply hung out
            // of the panel.
            maxWidth: Math.min(TIP_MAX_W, width),
            // Clamped by the width the box can reach (`TIP_MAX_W`), never a guess.
            left: Math.min(Math.max(x(hover ?? 0) - 80, 0), Math.max(0, width - TIP_MAX_W)),
            // Above a low dot, below otherwise. Anchoring the *bottom* edge when flipped
            // avoids needing a height that varies as the title wraps.
            ...(y(active.popularity) > PAD.top + plotHeight / 2
              ? { bottom: height - y(active.popularity) + 14 }
              : { top: y(active.popularity) + 14 }),
          }}
        >
          <p className="truncate text-[12px] font-semibold">{active.title}</p>
          <p className="truncate text-[11px] text-[var(--fg-dim)]">
            {active.artists.join(", ") || "Unknown artist"}
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-[var(--fg-faint)]">
            #{active.position} · {formatScore(active.popularity)} popularity
          </p>
        </div>
      )}
    </div>
  );
}
