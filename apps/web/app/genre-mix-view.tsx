import { StackedColumns } from "./stacked-columns";
import { RANK_BANDS } from "@/lib/rank-bands";
import type { GenreMix } from "@/lib/rankings";

/**
 * Explore's default view, rendered on the server.
 *
 * It lives outside `rankings-view.tsx` because that file is `"use client"` — and
 * anything a client component imports is compiled into the client bundle, however
 * static it is. This chart never changes after paint, so the page renders it and
 * passes it in as a node instead. That keeps the chart, `RANK_BANDS` and the column
 * mapping out of every Explore visitor's JavaScript.
 */
export function GenreMixView({ mix }: { mix: GenreMix[] }) {
  if (mix.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        No genre chart overlapped the ranking this week. Genre charts come from Deezer, and either
        it did not answer or none of its genre entries reached the fused top 100.
      </p>
    );
  }

  // Eight is the most that stays legible at the narrowest width — the chart fits its
  // container, so more columns only means thinner ones.
  const top = mix.slice(0, 8);

  return (
    <>
      <p className="mb-4 max-w-2xl text-xs text-[var(--fg-faint)]">
        How many of each genre&rsquo;s songs reached the ranking, and where they landed.
      </p>

      <StackedColumns
        columns={top.map((entry) => ({
          label: entry.genre,
          total: entry.total,
          values: entry.bands,
        }))}
        segments={RANK_BANDS}
        unit="song"
      />

      <p className="mt-5 max-w-2xl text-xs leading-relaxed text-[var(--fg-faint)]">
        One week&rsquo;s standings, not a trend — no free source publishes chart history.
      </p>
    </>
  );
}
