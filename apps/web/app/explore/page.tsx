import { Suspense } from "react";

import { fetchDiscover, type ChartTrack } from "@/lib/discover";
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

/**
 * Everything browsable, on one page.
 *
 * Charts used to be a tab of their own. It was a whole second page reached by a
 * nav entry, carrying four views nobody found — while Explore, which people do
 * open, had room to spare. Revalidated hourly, so the fifteen-odd requests
 * behind the ranking are paid once an hour by whoever arrives first.
 */
export const revalidate = 3600;

export default async function ExplorePage() {
  /*
   * Only what the top of the page needs.
   *
   * The ranking used to be awaited here too, which meant the fifteen-odd
   * requests behind it were on the critical path for markup that does not
   * contain it — nobody saw a genre pill until the charts had finished. Deezer
   * answers in one to two seconds, so that was most of the page's time.
   */
  const [initial, radios] = await Promise.all([fetchDiscover(0), fetchRadios()]);

  return (
    <DiscoverView
      initial={initial}
      radios={radios}
      /*
       * Streamed in behind a boundary rather than awaited.
       *
       * The charts sit below a full screen of browsing, so there is no reason
       * for them to hold up the part that is visible. React sends the shell
       * with the placeholder in it and swaps this in when Deezer answers.
       *
       * Passed as a prop rather than rendered inside `DiscoverView` because
       * that component is a client one: a server component cannot be imported
       * into it, but it can be handed in already rendered.
       */
      rankings={
        <Suspense fallback={<RankingsPending />}>
          <RankingsSection chart={initial.tracks} />
        </Suspense>
      }
    />
  );
}

/**
 * The charts, fetched independently of the page around them.
 *
 * `fetchGenreCharts` needs nothing from the ranking — see the note on it — so
 * the two run together and are matched up afterwards, rather than the genre
 * charts queueing behind a request they never depended on.
 */
async function RankingsSection({ chart }: { chart: ChartTrack[] }) {
  const [rankings, genreCharts] = await Promise.all([fetchRankings(100), fetchGenreCharts(12)]);

  return (
    <RankingsView
      rankings={rankings}
      share={shareByArtist(rankings.songs)}
      agree={agreement(rankings)}
      mix={mixGenres(genreCharts, rankings.songs)}
      chart={chart}
      embedded
    />
  );
}

/**
 * What stands in while the charts load.
 *
 * Sized to roughly what arrives, so the page does not jump when it does — a
 * placeholder shorter than its content is a scroll position that moves under
 * whoever is reading. No spinner: this is below the fold on every screen it was
 * designed for, and a spinner nobody looks at is an animation running for
 * nothing.
 */
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
