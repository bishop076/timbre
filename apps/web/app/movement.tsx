"use client";

/**
 * How far something has climbed since your last visit.
 *
 * The arrow carries the direction and the number carries the size, so colour is
 * reinforcement rather than the only channel — the same reading works in
 * greyscale, and for anyone who cannot separate the two hues.
 *
 * **Nothing is rendered on a first visit**, or for an entry that was not in the
 * previous reading. Timbre keeps no chart history on any server, so the
 * comparison is against a snapshot in this browser and there is genuinely
 * nothing to compare against the first time — an arrow invented from a single
 * measurement would be a number with nothing behind it. See `chart-memory.ts`.
 */
export function Movement({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;

  const up = delta > 0;
  return (
    <span
      className={`shrink-0 text-[11px] font-bold tabular-nums ${
        up ? "text-emerald-400" : "text-rose-400"
      }`}
      title={`${up ? "Up" : "Down"} ${Math.abs(delta)} since your last visit`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}
    </span>
  );
}
