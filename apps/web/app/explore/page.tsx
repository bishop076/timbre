import { Suspense } from "react";

import { fetchDiscover, type ChartTrack } from "@/lib/discover";
import { GenreMixView } from "../genre-mix-view";
import { fetchRadios } from "@/lib/radios";
import {
  agreement,
  fetchGenreCharts,
  fetchRankings,
  mixGenres,
  shareByArtist,
} from "@/lib/rankings";

import { DiscoverView } from "../discover-view";
import { RankingsView } from "../rankings-view";

export const metadata = { title: "Explore — Timbre" };

/** Everything browsable, on one page. Revalidated hourly, so the fifteen-odd requests
 * behind the ranking are paid once an hour by whoever arrives first. */
export const revalidate = 3600;

export default async function ExplorePage() {
  // Only what the top of the page needs. Awaiting the ranking here too put its requests on
  // the critical path for markup that does not contain it — one to two seconds of it.
  const [initial, radios] = await Promise.all([fetchDiscover(0), fetchRadios()]);

  return (
    <DiscoverView
      initial={initial}
      radios={radios}
      /* Streamed behind a boundary rather than awaited, and passed as a prop because
       * `DiscoverView` is a client component: a server component cannot be imported into one,
       * but it can be handed in already rendered. */
      rankings={
        <Suspense fallback={<RankingsPending />}>
          <RankingsSection chart={initial.tracks} />
        </Suspense>
      }
    />
  );
}

/** The charts, fetched independently of the page around them. `fetchGenreCharts` needs
 * nothing from the ranking, so the two run together and are matched up afterwards. */
async function RankingsSection({ chart }: { chart: ChartTrack[] }) {
  const [rankings, genreCharts] = await Promise.all([fetchRankings(100), fetchGenreCharts(12)]);

  return (
    <RankingsView
      rankings={rankings}
      share={shareByArtist(rankings.songs)}
      agree={agreement(rankings)}
      /* Rendered here rather than inside RankingsView, which is a client component:
         anything it imports ships as JavaScript, and this chart never changes after
         paint. See genre-mix-view.tsx. */
      genreMix={<GenreMixView mix={mixGenres(genreCharts, rankings.songs)} />}
      chart={chart}
      embedded
    />
  );
}

/** What stands in while the charts load, sized to roughly what arrives — a placeholder
 * shorter than its content moves the scroll position under whoever is reading. */
function RankingsPending() {
  return (
    <div className="animate-pulse">
      <div className="h-5 w-28 rounded-[var(--r-md)] bg-[var(--surface-2)]" />
      <div className="mt-2 h-3 w-full max-w-2xl rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
      <div className="mt-5 flex flex-col gap-5 @3xl:flex-row @3xl:gap-7">
        <div className="flex shrink-0 gap-1.5 @3xl:w-52 @3xl:flex-col">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="h-9 w-24 rounded-[var(--r-md)] bg-[var(--surface-2)] @3xl:w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="h-5 w-32 rounded-[var(--r-md)] bg-[var(--surface-2)]" />
          <div className="mt-4 h-[220px] rounded-[var(--r-lg)] bg-[var(--surface-1)]" />
        </div>
      </div>
    </div>
  );
}
