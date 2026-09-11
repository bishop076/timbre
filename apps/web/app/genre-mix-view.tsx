import { StackedColumns } from "./stacked-columns";
import { RANK_BANDS } from "@/lib/rank-bands";
import type { GenreMix } from "@/lib/rankings";

export function GenreMixView({ mix }: { mix: GenreMix[] }) {
  if (mix.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        No genre chart overlapped the ranking this week. Genre charts come from Deezer, and either
        it did not answer or none of its genre entries reached the fused top 100.
      </p>
    );
  }

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
