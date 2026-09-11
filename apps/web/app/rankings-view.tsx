"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { toArtistSlug } from "./artist-slug";
import { Movement } from "./movement";
import { Caption, Notice, SectionTitle } from "./page-chrome";
import { usePlayerControls } from "./player/player-context";
import { RankedList } from "./song-row";
import { ROW_BADGES, SourceBadges } from "./source-badges";
import { sourceStyle } from "./sources";
import { SOURCE_TAG } from "./source-tag";
import { useTaste } from "./taste-store";
import { artistKey, listNames } from "@/lib/genre-tally";
import type { ChartTrack } from "@/lib/discover";
import type { agreement, Rankings, shareByArtist } from "@/lib/rankings";

const BarChart = dynamic(() => import("./bar-chart").then((m) => m.BarChart));
const ChartGraph = dynamic(() => import("./chart-graph").then((m) => m.ChartGraph));

const FUSED_RANKING = -1;

type Share = ReturnType<typeof shareByArtist>;
type Agreement = ReturnType<typeof agreement>;
type ViewId = "yours" | "mix" | "spread" | "songs" | "artists" | "agreement";

const VIEWS: { id: ViewId; label: string; blurb: string }[] = [
  { id: "yours", label: "For you", blurb: "The ranking, narrowed to the genres and artists you play" },
  { id: "mix", label: "Genre mix", blurb: "Which genres feed the chart, and how high they land" },
  { id: "spread", label: "Popularity", blurb: "Chart position against catalogue popularity" },
  { id: "songs", label: "Top songs", blurb: "Ranked across every chart at once" },
  { id: "artists", label: "Top artists", blurb: "Who holds the most places" },
  { id: "agreement", label: "Chart agreement", blurb: "Where the sources disagree" },
];

export function RankingsView({
  rankings,
  songGenres,
  genreNames,
  share,
  agree,
  genreMix,
  chart,
}: {
  rankings: Rankings;
  songGenres: Record<string, number[]>;
  genreNames: Record<number, string>;
  share: Share;
  agree: Agreement;
  genreMix: ReactNode;
  chart: ChartTrack[];
}) {
  const taste = useTaste();
  const [picked, setPicked] = useState<ViewId | null>(null);
  const view: ViewId = picked ?? (taste.genres.length > 0 ? "yours" : "mix");
  const current = VIEWS.find((entry) => entry.id === view)!;

  return (
    <div>
      <SectionTitle>Rankings</SectionTitle>
      {rankings.songs.length === 0 ? (
        <Notice className="mt-3">
          No chart answered just now. This is built entirely from other services&rsquo; published
          charts, so when none of them reply there is nothing honest to show.
        </Notice>
      ) : (
        <>
          <Caption className="mt-1.5 max-w-2xl">
            Built from{" "}
            {rankings.charts.length === 1
              ? "one published chart"
              : `${rankings.charts.length} published charts`}{" "}
            — {rankings.charts.map((chart) => sourceStyle(chart).label).join(" and ")}. Charting on
            more than one outranks charting higher on one.
          </Caption>

          <div className="mt-5 flex flex-col gap-5 @3xl:flex-row @3xl:gap-7">
            <nav
              aria-label="Ranking views"
              className="-mx-1 flex shrink-0 flex-wrap gap-1.5 px-1 @3xl:mx-0 @3xl:w-52 @3xl:flex-col @3xl:flex-nowrap"
            >
              {VIEWS.map((entry) => {
                const active = entry.id === view;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setPicked(entry.id)}
                    aria-current={active ? "true" : undefined}
                    className={`press shrink-0 rounded-[var(--r-md)] px-3 py-2 text-left text-[13px] font-semibold transition @3xl:w-full ${
                      active
                        ? "slab-sm text-[var(--accent-fg)]"
                        : "bg-[var(--surface-2)] text-[var(--fg-dim)] hover:text-[var(--fg)] @3xl:bg-transparent"
                    }`}
                    style={active ? { background: "var(--accent)" } : undefined}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0 flex-1">
              <SectionTitle>{current.label}</SectionTitle>
              <Caption className="mt-1">{current.blurb}</Caption>

              <div className="mt-4">
                {view === "yours" && (
                  <YoursView rankings={rankings} songGenres={songGenres} genreNames={genreNames} />
                )}
                {view === "mix" && genreMix}
                {view === "spread" && <SpreadView chart={chart} />}
                {view === "songs" && <SongsView rankings={rankings} />}
                {view === "artists" && <ArtistsView share={share} total={rankings.songs.length} />}
                {view === "agreement" && <AgreementView agree={agree} rankings={rankings} />}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function YoursView({
  rankings,
  songGenres,
  genreNames,
}: {
  rankings: Rankings;
  songGenres: Record<string, number[]>;
  genreNames: Record<number, string>;
}) {
  const taste = useTaste();
  const top = taste.genres.slice(0, 3).map((genre) => genre.id);
  const topNames = listNames(
    top.map((id) => genreNames[id]).filter((name): name is string => Boolean(name)),
  );

  const picks = rankings.songs.flatMap((song) => {
    if (song.artists.some((artist) => taste.artists.has(artistKey(artist)))) {
      return [{ song, why: "You play them" }];
    }
    const genre = (songGenres[song.id] ?? []).find((id) => top.includes(id));
    return genre === undefined ? [] : [{ song, why: genreNames[genre] ?? "Your genre" }];
  });

  if (!taste.listening) {
    return (
      <Notice>
        Play a few songs and this narrows the ranking to the genres and artists you listen to.
        It is worked out in your browser, from the history it keeps.
      </Notice>
    );
  }

  if (picks.length === 0) {
    return (
      <Notice>
        {taste.genres.length === 0
          ? "Still working out the genres you play — this fills in as it does."
          : `Nothing in this week's top ${rankings.songs.length} is in ${
              topNames || "your genres"
            }, or by anyone you have played.`}
      </Notice>
    );
  }

  return (
    <>
      <Caption className="mb-3">
        {picks.length} of the top {rankings.songs.length}, numbered by their place overall.
        {topNames && ` Your genres, by what you played lately: ${topNames}.`}
      </Caption>

      <RankedList
        songs={picks.map((pick) => pick.song)}
        extra={(song, index) => (
          <>
            <span className={`${SOURCE_TAG} hidden shrink-0 @lg:inline`}>{picks[index]!.why}</span>
            <SourceBadges song={song} className={ROW_BADGES} />
          </>
        )}
      />
    </>
  );
}

function SongsView({ rankings }: { rankings: Rankings }) {
  const { songs } = rankings;
  const snapshot = useChartSnapshot(FUSED_RANKING, songs);

  return (
    <>
      {snapshot && (
        <Caption className="mb-3">
          Movement {describeAge(snapshot.at)}, on this device only.
        </Caption>
      )}

      <RankedList
        songs={songs.slice(0, 50)}
        queue={songs}
        extra={(song) => (
          <>
            <Movement delta={movementOf(snapshot, song.id, song.position)} />

            <div className="hidden shrink-0 items-center gap-1 @lg:flex">
              {song.charts.map((chart) => {
                const style = sourceStyle(chart);
                return (
                  <span
                    key={chart}
                    title={`#${song.positions[chart]} on ${style.label}`}
                    className={`${SOURCE_TAG} shrink-0 tabular-nums`}
                  >
                    {style.short} #{song.positions[chart]}
                  </span>
                );
              })}
            </div>

            <SourceBadges song={song} className={ROW_BADGES} />
          </>
        )}
      />
    </>
  );
}

function ArtistsView({ share, total }: { share: Share; total: number }) {
  const router = useRouter();
  const rows = share.filter((row) => row.entries > 1).slice(0, 15);

  if (rows.length === 0) {
    return (
      <Notice>
        No artist holds more than one place this week — {total} songs, {total} different names.
      </Notice>
    );
  }

  return (
    <>
      <Caption className="mb-4">Out of {total} songs, counted by lead artist only.</Caption>

      <BarChart
        rows={rows.map((row) => ({
          key: row.artist,
          label: row.artist,
          value: row.entries,
          note: `Highest placing: #${row.best}`,
        }))}
        unit="place"
        onPick={(artist) => router.push(`/artist/${toArtistSlug(artist)}`)}
      />
    </>
  );
}

function AgreementView({ agree, rankings }: { agree: Agreement; rankings: Rankings }) {
  const percent = agree.total > 0 ? Math.round((agree.shared / agree.total) * 100) : 0;

  return (
    <>
      <p className="text-4xl font-extrabold tracking-tight">{percent}%</p>
      <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--fg-dim)]">
        of the {agree.total} ranked songs appear on more than one chart.
      </p>

      <div className="mt-5">
        <BarChart
          rows={[
            { key: "shared", label: "On more than one", value: agree.shared },
            ...agree.only.map((entry) => ({
              key: entry.chart,
              label: `Only on ${sourceStyle(entry.chart).label}`,
              value: entry.count,
            })),
          ]}
          unit="song"
        />
      </div>

      {rankings.failed.length > 0 && (
        <Caption className="mt-5">
          {rankings.failed.map((chart) => sourceStyle(chart).label).join(", ")} did not answer.
        </Caption>
      )}

      <Caption className="mt-5 max-w-xl">
        Two agreeing charts beat one asserting — still only two Western services.
      </Caption>
    </>
  );
}

function SpreadView({ chart }: { chart: ChartTrack[] }) {
  const { play } = usePlayerControls();

  if (chart.length < 2) {
    return (
      <Notice>
        Deezer&rsquo;s chart did not answer, and the popularity score is its measure — there is
        nothing to plot without it.
      </Notice>
    );
  }

  return (
    <>
      <Caption className="mb-4 max-w-2xl">
        Each dot is a song in chart order; height is its catalogue popularity.
      </Caption>

      <div className="slab rounded-[var(--r-lg)] bg-[var(--surface-1)] p-3 sm:p-4">
        <ChartGraph tracks={chart} onPick={(track) => play(track, chart)} height={220} />
      </div>
    </>
  );
}
