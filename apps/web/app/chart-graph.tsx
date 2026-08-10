"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChartTrack } from "@/lib/discover";

/**
 * The chart, plotted.
 *
 * **Why a dot plot and not bars.** Deezer publishes a popularity score beside
 * every charting track, and the scores sit in a narrow band near the top of
 * their range — this week's spread is roughly 600k to 999k out of a million.
 * A bar has to grow from zero or its length lies about the ratio, and from zero
 * every one of these bars is between 60% and 100% full: twenty-five near
 * identical blocks. A dot carries no length, so it can sit on a scale that
 * starts where the data does, and the differences become visible without
 * anything being overstated.
 *
 * **What it actually shows, which is not what it looks like.** Position and
 * popularity are two different measures and they disagree — this week's #16 is
 * a remastered Clash single with the *lowest* catalogue popularity on the board,
 * and #9 has the highest while sitting eight places down. The graph is worth
 * having because of that disagreement: a flat line would mean the chart was
 * simply popularity re-sorted, and there would be nothing to look at. The
 * caption says so plainly, because a reader who assumes the dots should descend
 * will read the scatter as a bug.
 *
 * Every plotted value is also readable as text one link away, on the chart's own
 * page — a value reachable *only* by pointing at a dot is the one thing a graph
 * must never do.
 */

/** Plot chrome, in pixels. Left is wide enough for a `1.0M` tick. */
const PAD = { left: 42, right: 14, top: 14, bottom: 20 };

/** The tooltip's widest, matching its `max-w-[15rem]`. Kept in step by hand. */
const TIP_MAX_W = 240;

/**
 * Measured before the browser paints, not after.
 *
 * The plot needs its own width before it can draw anything, and an effect that
 * runs *after* paint means the first frame is an empty box — which is exactly
 * what made switching to this view flicker. `useLayoutEffect` runs between
 * render and paint, so the measurement lands in the same frame.
 *
 * It falls back to `useEffect` on the server, where there is no layout to read
 * and React warns about the layout variant being useless. This component is
 * client-side but still server-rendered, so it hits that path on every request.
 */
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

function formatScore(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/**
 * Four ticks on a round number.
 *
 * The band is padded outwards to the enclosing round values so the extreme dots
 * are never clipped against the frame, and so the axis reads as a scale rather
 * than as "exactly the range of this data".
 */
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

  /*
   * Measured, not a viewBox.
   *
   * Scaling an SVG with `viewBox` scales its text with it, so a 12px axis label
   * renders at 6px on a phone. Laying the plot out in real pixels keeps the
   * labels at the size they were chosen to be at every width.
   */
  useMeasure(() => {
    const element = box.current;
    if (!element) return;

    // Read once up front. The observer does fire on observe, but only on the
    // next frame — and that frame is the empty one this is here to avoid.
    setWidth(element.clientWidth);

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = tracks.filter((track) => track.popularity > 0);

  // One point cannot show a spread, and zero cannot show anything. Below two the
  // graph would be a single dot on an invented axis, so it stands down and lets
  // the list speak for itself.
  if (points.length < 2) return <div ref={box} />;

  const { min, max, ticks } = scale(points.map((track) => track.popularity));
  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    PAD.top + plotHeight - ((value - min) / (max - min || 1)) * plotHeight;

  // Smaller dots when they would otherwise touch. The 2px surface ring is what
  // keeps neighbours legible where they nearly overlap, so it never shrinks.
  const gap = plotWidth / Math.max(1, points.length - 1);
  const radius = gap < 14 ? 3.5 : 4.5;

  const active = hover !== null ? points[hover] : null;

  return (
    /*
     * The height is reserved, not left to the contents.
     *
     * Without it the box is empty — and so zero-tall — until a width has been
     * measured, and the card around it collapsed and sprang open every time
     * this view was opened. Server-rendered markup has no width either, so the
     * jump happened on first paint as well as on every click of the rail.
     *
     * Stating the height the plot is going to be is also just honest layout:
     * the caller passes a fixed height, so nothing here was ever going to size
     * itself from its contents.
     */
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
            // Nearest point rather than a hit on the dot itself: a 9px target is
            // far too small to ask anyone to land on.
            const index = Math.round((offset / (plotWidth || 1)) * (points.length - 1));
            setHover(Math.min(points.length - 1, Math.max(0, index)));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              {/* Solid hairlines, one step off the surface. Dashes read as a
                  threshold or a projection when they are only a grid. */}
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

          {/* The hovered position, marked on the plot rather than only in the
              tooltip, so the reader can see which dot they are being told about. */}
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
                // The ring is the surface, not a border: it is what keeps two
                // dots that nearly overlap from reading as one lumpy mark.
                stroke="var(--surface-1)"
                strokeWidth={2}
                onClick={() => onPick?.(track)}
                className={onPick ? "cursor-pointer" : undefined}
              />
            );
          })}

          {/* Only the ends are labelled. A number under every dot is the fastest
              way to make a graph unreadable. */}
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
          className="slab pointer-events-none absolute z-20 max-w-[15rem] rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-2 shadow-[var(--drop-lg)]"
          style={{
            /*
             * Clamped so a tooltip near either end is never cut off by the card
             * that holds it.
             *
             * The right-hand bound has to be the width this box can actually
             * reach — `max-w-[15rem]`, 240px — and it was 170. A long enough
             * title on one of the last few dots grew past the clamp and hung
             * outside the card, the same failure as the vertical one below.
             */
            left: Math.min(Math.max(x(hover ?? 0) - 80, 0), Math.max(0, width - TIP_MAX_W)),
            /*
             * Above the dot when the dot is low, below it otherwise.
             *
             * Anchoring the *bottom* edge for the flipped case is what makes
             * this work without knowing how tall the tooltip is — and it varies,
             * since the title and artist wrap. Positioned with `top` and a
             * guessed height, a three-line tooltip on a low dot hung out through
             * the bottom of the card, which is where the 600k end of this scale
             * lives.
             */
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
