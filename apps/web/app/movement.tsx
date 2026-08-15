"use client";

/**
 * How far something has climbed since your last visit. The arrow carries direction and
 * the number size, so colour is reinforcement rather than the only channel.
 *
 * Nothing is rendered on a first visit, or for an entry absent from the previous reading:
 * the comparison is against a snapshot in this browser, so there is genuinely nothing to
 * compare against the first time. See `chart-memory.ts`.
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
