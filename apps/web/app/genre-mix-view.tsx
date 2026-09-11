import { Caption, Notice } from "./page-chrome";
import { StackedColumns } from "./stacked-columns";
import { RANK_BANDS } from "@/lib/rank-bands";
import type { GenreMix } from "@/lib/rankings";

export function GenreMixView({ mix }: { mix: GenreMix[] }) {
  if (mix.length === 0) {
    return (
      <Notice>
        No genre chart overlapped the ranking this week. Genre charts come from Deezer, and either
        it did not answer or none of its genre entries reached the fused top 100.
      </Notice>
    );
  }

  return (
    <>
      <p className="mb-4 max-w-2xl text-xs text-[var(--fg-faint)]">
        How many of each genre&rsquo;s songs reached the ranking, and where they landed.
      </p>

      <StackedColumns
        columns={mix.slice(0, 8).map((entry) => ({
          label: entry.genre,
          total: entry.total,
          values: entry.bands,
        }))}
        segments={RANK_BANDS}
        unit="song"
      />

      <Caption className="mt-5 max-w-2xl">
        One week&rsquo;s standings, not a trend — no free source publishes chart history.
      </Caption>
    </>
  );
}
