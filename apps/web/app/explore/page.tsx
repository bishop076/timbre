import { connection } from "next/server";
import { Suspense } from "react";

import { fetchDiscover, type ChartTrack } from "@/lib/discover";
import type { FeedProbe } from "@/lib/genre-feed";
import { fetchRadios } from "@/lib/radios";
import { currentRotation } from "@/lib/rotation";
import {
  agreement,
  fetchGenreCharts,
  fetchRankings,
  genresBySong,
  mixGenres,
  shareByArtist,
} from "@/lib/rankings";

import { DiscoverView } from "../discover-view";
import { GenreMixView } from "../genre-mix-view";
import { RankingsView } from "../rankings-view";

export const metadata = {
  title: "Explore — Timbre",
  description:
    "Charts, stations and genre shelves drawn from the catalogues Timbre plays, plus a ranking built by agreement between them.",
};
export const revalidate = 3600;

export default async function ExplorePage() {
  const rotation = currentRotation(3_600_000);

  const [initial, radios] = await Promise.all([fetchDiscover(0, rotation), fetchRadios()]);

  return (
    <DiscoverView
      initial={initial}
      radios={radios}
      rotation={rotation}
      rankings={
        <Suspense fallback={<RankingsPending />}>
          <RankingsSection chart={initial.tracks} />
        </Suspense>
      }
    />
  );
}

/**
 * The genre shelves, and the one thing this page must not remember.
 *
 * Thirty genre charts are read here, and `fetchChartTracks` forgives a refusal into `[]` — so a
 * genre Deezer would not answer for is indistinguishable from a genre no charting song belongs
 * to. It drops out of the genre mix and off every song's chips, and the page is `revalidate =
 * 3600` over a year of `stale-while-revalidate`, so that gap is what everyone is served until a
 * revalidation replaces it. Measured on a production build with one genre's chart refused:
 * `cache-control: s-maxage=3600, stale-while-revalidate=31532400`, `x-nextjs-cache: HIT`.
 *
 * `connection()` is the whole fix and it is deliberately after the reads: it is reached only when
 * a read was refused, and reaching it takes this render off the static path. Deezer answering
 * normally is the ordinary case and still prerenders, unchanged.
 *
 * It lands in the two places a refusal can happen, and neither of them keeps it, which is the
 * point:
 *
 * - **Refused while the build prerenders.** The route is built dynamic and every reader gets a
 *   fresh render: `private, no-cache, no-store, max-age=0, must-revalidate`.
 * - **Refused on a revalidation an hour in**, which is the common one. The revalidation declines
 *   — `digest: DYNAMIC_SERVER_USAGE`, one line under the `deezer_unavailable` that says why — the
 *   last whole page keeps being served `STALE`, and the next request tries again. The reader gets
 *   the last Explore that was true rather than a thinner one.
 *
 * Nothing on screen moves. What a refused genre looks like is exactly what was settled for the
 * For-you shelves and is not restated here; this closes the half of it that is about caching.
 */
async function RankingsSection({ chart }: { chart: ChartTrack[] }) {
  const probe: FeedProbe = { failed: false };
  const [rankings, genreCharts] = await Promise.all([
    fetchRankings(100),
    fetchGenreCharts(30, probe),
  ]);

  if (probe.failed) await connection();

  return (
    <RankingsView
      rankings={rankings}
      songGenres={genresBySong(genreCharts, rankings.songs)}
      genreNames={Object.fromEntries(genreCharts.map((chart) => [chart.id, chart.genre]))}
      share={shareByArtist(rankings.songs)}
      agree={agreement(rankings)}
      genreMix={<GenreMixView mix={mixGenres(genreCharts, rankings.songs)} />}
      chart={chart}
    />
  );
}

const BAR = "animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]";

/**
 * Stands in for <RankingsView> while the charts are fetched.
 *
 * Measured against the real thing rather than sketched: the heading boxes are h-7 because
 * SectionTitle is 28px of line-height, the caption boxes are one line of `text-xs
 * leading-relaxed`, and a view button is 37px tall with six of them, not five. The old version
 * was short on every count and finished with a blank 220px panel, so the section grew as it
 * settled.
 *
 * The panel is drawn as ranked rows instead, at SongRow's own `py-3` and `size-12` — which is
 * what four of the six views actually show. Reserving the full height a loaded ranking takes
 * would put ~550px of grey on a 690px screen, and nothing sits below this section for a late
 * reflow to push around, so the rows stop at six.
 */
function RankingsPending() {
  return (
    <div>
      <p role="status" className="sr-only">
        Loading rankings.
      </p>

      <div aria-hidden>
        <div className="flex h-7 items-center">
          <div className={`h-5 w-28 ${BAR}`} />
        </div>
        <div className="mt-1.5 flex h-5 max-w-2xl items-center">
          <div className={`h-3 w-full ${BAR}`} />
        </div>

        <div className="mt-5 flex flex-col gap-5 @3xl:flex-row @3xl:gap-7">
          {/* The real nav wraps into a pill row below @3xl and becomes a 13rem column above it;
              the negative margin and padding are what keep its focus rings from being clipped.

              Each placeholder is an unselected view button with the ink taken out — same padding,
              same `slab-ghost` edge, same 13px line box — so its height is derived rather than
              measured. The version this replaced hard-coded the height it happened to measure at
              the time, which `--edge` going from 1px back to 2px would have quietly falsified. */}
          <div className="-mx-1 flex shrink-0 flex-wrap gap-1.5 px-1 @3xl:mx-0 @3xl:w-52 @3xl:flex-col @3xl:flex-nowrap">
            {[0, 1, 2, 3, 4, 5].map((view) => (
              <div
                key={view}
                className="slab-ghost w-24 shrink-0 animate-pulse rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-semibold text-transparent @3xl:w-full"
              >
                View
              </div>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex h-7 items-center">
              <div className={`h-5 w-32 ${BAR}`} />
            </div>
            <div className="mt-1 flex h-5 items-center">
              <div className={`h-3 w-64 max-w-full ${BAR}`} />
            </div>

            <ul className="mt-4">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <li key={row} className="flex items-center gap-2.5 py-2 sm:gap-4 sm:py-3">
                  <div className={`h-3.5 w-4 shrink-0 ${BAR}`} />
                  <div className="size-10 shrink-0 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)] sm:size-12" />
                  <div className="min-w-0 flex-1">
                    <div className={`h-3.5 w-1/3 ${BAR}`} />
                    <div className={`mt-2 h-3 w-1/5 ${BAR}`} />
                  </div>
                  <div className={`hidden h-3 w-10 shrink-0 @md:block ${BAR}`} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
