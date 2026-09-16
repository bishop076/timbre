import { Caption, Notice } from "./page-chrome";
import { StackedColumns } from "./stacked-columns";
import { RANK_BANDS } from "@/lib/rank-bands";
import type { GenreMix } from "@/lib/rankings";

/**
 * Which genres fed the ranking — and, when Deezer would not say, that it would not say.
 *
 * Thirty genre charts are read for this. `fetchChartTracks` forgives a refusal into `[]`, so a
 * genre Deezer was rate limiting counted nothing and `mixGenres` dropped it: the column simply
 * was not drawn, and the chart went on reading as the whole week's mix. Refusing Pop, Rock and
 * Rap/Hip Hop leaves a plausible-looking eight columns led by Alternative, with nothing on the
 * page saying the three biggest genres were never counted.
 *
 * `refused` is `FeedProbe.failed` from the same read, which was threaded through to stop the
 * thinned page being cached. That was the caching half; this is what the reader is told. The
 * empty case stops hedging with it too — "either it did not answer or nothing reached the top
 * 100" was two different weeks described as one, and the probe knows which.
 */
export function GenreMixView({ mix, refused }: { mix: GenreMix[]; refused: boolean }) {
  if (mix.length === 0) {
    return (
      <Notice>
        {refused
          ? "Deezer wouldn’t answer for its genre charts just now, so there is no mix to draw. This is a gap, not a week in which no genre reached the ranking."
          : "No genre chart overlapped the ranking this week. Genre charts come from Deezer, and none of its genre entries reached the fused top 100."}
      </Notice>
    );
  }

  return (
    <>
      {refused && (
        <Notice className="mb-4 max-w-2xl">
          Deezer wouldn&rsquo;t answer for some of its genre charts, so genres are missing from
          this one. A genre that is not drawn below may simply never have been counted.
        </Notice>
      )}

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
        rowLabel="Genre"
        caption="How many of each genre's songs reached the ranking, and where they landed"
      />

      <Caption className="mt-5 max-w-2xl">
        One week&rsquo;s standings, not a trend — no free source publishes chart history.
      </Caption>
    </>
  );
}
