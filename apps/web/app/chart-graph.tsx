"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChartTrack } from "@/lib/discover";

const PAD = { left: 42, right: 14, top: 14, bottom: 20 };
const TIP_MAX_W = 240;
const AXIS_TEXT = "fill-[var(--fg-faint)] text-[10px] tabular-nums";

const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

function formatScore(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function scale(values: number[]): { min: number; max: number; ticks: number[] } {
  const low = Math.min(...values);
  const high = Math.max(...values);
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
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useMeasure(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = tracks.filter((track) => track.popularity > 0);
  if (points.length < 2) return <div ref={box} />;

  const { min, max, ticks } = scale(points.map((track) => track.popularity));
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;
  const gap = plotWidth / (points.length - 1);
  const radius = gap < 14 ? 3.5 : 4.5;

  const x = (index: number) => PAD.left + index * gap;
  const y = (value: number) =>
    PAD.top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;

  const active = hover === null ? null : points[hover];
  const activeY = active ? y(active.popularity) : 0;

  return (
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
            const index = Math.round((offset / (plotWidth || 1)) * (points.length - 1));
            setHover(Math.min(points.length - 1, Math.max(0, index)));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
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
                className={AXIS_TEXT}
              >
                {formatScore(tick)}
              </text>
            </g>
          ))}

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

          {points.map((point, index) => (
            <circle
              key={point.id}
              cx={x(index)}
              cy={y(point.popularity)}
              r={hover === index ? radius + 1.5 : radius}
              fill="var(--accent)"
              stroke="var(--surface-1)"
              strokeWidth={2}
              onClick={() => onPick?.(point)}
              className={onPick ? "cursor-pointer" : undefined}
            />
          ))}

          <text x={PAD.left} y={height - 5} textAnchor="start" className={AXIS_TEXT}>
            #1
          </text>
          <text x={width - PAD.right} y={height - 5} textAnchor="end" className={AXIS_TEXT}>
            #{points.length}
          </text>
        </svg>
      )}

      {active && (
        <div
          className="slab pointer-events-none absolute z-20 rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-2 shadow-[var(--drop-lg)]"
          style={{
            maxWidth: Math.min(TIP_MAX_W, width),
            left: Math.min(Math.max(x(hover ?? 0) - 80, 0), Math.max(0, width - TIP_MAX_W)),
            ...(activeY > PAD.top + plotHeight / 2
              ? { bottom: height - activeY + 14 }
              : { top: activeY + 14 }),
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
