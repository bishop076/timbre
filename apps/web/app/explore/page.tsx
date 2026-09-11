import { Suspense } from "react";

import { fetchDiscover, type ChartTrack } from "@/lib/discover";
import { GenreMixView } from "../genre-mix-view";
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
import { RankingsView } from "../rankings-view";

export const metadata = { title: "Explore — Timbre" };

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

async function RankingsSection({ chart }: { chart: ChartTrack[] }) {
  const [rankings, genreCharts] = await Promise.all([fetchRankings(100), fetchGenreCharts(30)]);

  return (
    <RankingsView
      rankings={rankings}
      songGenres={genresBySong(genreCharts, rankings.songs)}
      genreNames={Object.fromEntries(genreCharts.map((chart) => [chart.id, chart.genre]))}
      share={shareByArtist(rankings.songs)}
      agree={agreement(rankings)}
      genreMix={<GenreMixView mix={mixGenres(genreCharts, rankings.songs)} />}
      chart={chart}
      embedded
    />
  );
}

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
