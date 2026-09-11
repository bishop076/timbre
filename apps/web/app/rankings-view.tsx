"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArtistLink } from "./artist-link";
import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { toArtistSlug } from "./artist-slug";
import { Movement } from "./movement";
import { usePlayerControls } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { SongRow } from "./song-row";
import { ROW_BADGES, SourceBadges } from "./source-badges";
import { sourceStyle } from "./sources";
import { SOURCE_TAG } from "./source-tag";
import { useTaste } from "./taste-store";
import { artistKey, listNames } from "@/lib/genre-tally";

// Fetched when a tab opens. The genre chart is not here at all — the server page renders
// it and passes it in, so it costs no JavaScript. The split
// must be here, not `explore/page.tsx` — this Next version won't code-split a Client
// Component that a Server Component imports dynamically.
const BarChart = dynamic(() => import("./bar-chart").then((m) => m.BarChart));
const ChartGraph = dynamic(() => import("./chart-graph").then((m) => m.ChartGraph));
import type { ChartTrack } from "@/lib/discover";
import type { Rankings } from "@/lib/rankings";

/*
 * Rankings — a rail of views down the side. No source publishes chart history keyless and
 * there is no server to accumulate it, so every view is one week's standings, never a
 * trend. Movement is the exception, and labelled personal.
 */

/** Snapshot key for the fused ranking. Named, not a bare `-1` — see `chart-memory.ts`. */
const FUSED_RANKING = -1;

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
  embedded = false,
}: {
  rankings: Rankings;
  /** Song id to the Deezer genre charts it is on. */
  songGenres: Record<string, number[]>;
  genreNames: Record<number, string>;
  share: { artist: string; entries: number; best: number }[];
  agree: { shared: number; only: { chart: string; count: number }[]; total: number };
  /* Rendered by the server page — see genre-mix-view.tsx for why. */
  genreMix: React.ReactNode;
  chart: ChartTrack[];
  /** Rendered inside another page rather than as one. Explore embeds it; `/rankings` is the direct link. */
  embedded?: boolean;
}) {
  const taste = useTaste();
  const [picked, setPicked] = useState<ViewId | null>(null);
  // A listener's own view leads once their genres are known; otherwise the graph does — a
  // rankings page that opens on a list is a list with a menu. Derived rather than set, so it
  // follows the history arriving after hydration and yields the moment anything is pressed.
  const view: ViewId = picked ?? (taste.genres.length > 0 ? "yours" : genreMix ? "mix" : "songs");
  const current = VIEWS.find((entry) => entry.id === view)!;

  // The failure state respects `embedded` too, or a page with an <h1> gets a second.
  if (rankings.songs.length === 0) {
    return (
      <div className={embedded ? "" : "mx-auto w-full max-w-6xl px-4 py-16 sm:px-7"}>
        {embedded ? (
          <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">Rankings</h2>
        ) : (
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Rankings</h1>
        )}
        <p className="mt-3 text-sm leading-relaxed text-[var(--fg-dim)]">
          No chart answered just now. This is built entirely from other services&rsquo; published
          charts, so when none of them reply there is nothing honest to show.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        embedded
          ? ""
          : "@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4"
      }
    >
      {embedded ? (
        <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">Rankings</h2>
      ) : (
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Rankings</h1>
      )}
      <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--fg-faint)]">
        Built from{" "}
        {rankings.charts.length === 1
          ? "one published chart"
          : `${rankings.charts.length} published charts`}
        {rankings.charts.length > 0 && (
          <> — {rankings.charts.map((chart) => sourceStyle(chart).label).join(" and ")}</>
        )}
        . Charting on more than one outranks charting higher on one.
      </p>

      <div className="mt-5 flex flex-col gap-5 @3xl:flex-row @3xl:gap-7">
        {/*
          Chips wrap on a phone, a column on a wide screen. Never side-scroll them:
          a label clipped at the panel edge reads as broken, not as scrollable.
        */}
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
          <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{current.label}</h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fg-faint)]">{current.blurb}</p>

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
    </div>
  );
}

/** How many of a listener's genres the view narrows to. Past three it is most of the chart. */
const YOUR_GENRES = 3;

/**
 * The fused ranking with only what this listener would pick out of it: songs by artists in
 * their history, and songs charting in their top genres. Numbered by their place in the whole
 * ranking, so "#4" still means fourth overall — renumbering would claim a chart of one's own.
 */
function YoursView({
  rankings,
  songGenres,
  genreNames,
}: {
  rankings: Rankings;
  songGenres: Record<string, number[]>;
  genreNames: Record<number, string>;
}) {
  const { play, current, state } = usePlayerControls();
  const taste = useTaste();
  const top = taste.genres.slice(0, YOUR_GENRES).map((genre) => genre.id);
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
  const songs = picks.map((pick) => pick.song);

  if (!taste.listening) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        Play a few songs and this narrows the ranking to the genres and artists you listen to.
        It is worked out in your browser, from the history it keeps.
      </p>
    );
  }

  if (picks.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        {taste.genres.length === 0
          ? "Still working out the genres you play — this fills in as it does."
          : `Nothing in this week's top ${rankings.songs.length} is in ${
              topNames || "your genres"
            }, or by anyone you have played.`}
      </p>
    );
  }

  return (
    <>
      <p className="mb-3 text-xs leading-relaxed text-[var(--fg-faint)]">
        {picks.length} of the top {rankings.songs.length}, numbered by their place overall.
        {topNames && ` Your genres, by what you played lately: ${topNames}.`}
      </p>

      <ul className="divide-y divide-[var(--line)]">
        {picks.map(({ song, why }) => (
          <SongRow
            key={song.id}
            song={song}
            onPlay={() => play(song, songs)}
            isCurrent={current?.id === song.id}
            isPlaying={state === "playing"}
            size="sm"
            rank={song.position}
            rankPlays
            subtitle={<ArtistLink artists={song.artists} />}
            trailing={
              <>
                <span className={`${SOURCE_TAG} hidden shrink-0 @lg:inline`}>{why}</span>
                <SourceBadges song={song} className={ROW_BADGES} />
                <AddToPlaylist
                  song={song}
                  className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                />
              </>
            }
          />
        ))}
      </ul>
    </>
  );
}

function SongsView({ rankings }: { rankings: Rankings }) {
  const { play, current, state } = usePlayerControls();
  const songs = rankings.songs;

  // A reserved key, not a genre id: the fused ranking against a genre snapshot reports
  // movement that never happened. Genre ids are non-negative, so this can't collide.
  const snapshot = useChartSnapshot(FUSED_RANKING, songs);

  return (
    <>
      {snapshot && (
        <p className="mb-3 text-xs leading-relaxed text-[var(--fg-faint)]">
          Movement {describeAge(snapshot.at)}, on this device only.
        </p>
      )}

      <ul className="divide-y divide-[var(--line)]">
        {songs.slice(0, 50).map((song) => (
          <SongRow
            key={song.id}
            song={song}
            onPlay={() => play(song, songs)}
            isCurrent={current?.id === song.id}
            isPlaying={state === "playing"}
            size="sm"
            rank={song.position}
            rankPlays
            subtitle={<ArtistLink artists={song.artists} />}
            trailing={
              <>
                <Movement delta={movementOf(snapshot, song.id, song.position)} />

                {/* Which charts carried it, and where — a badge pair means two audiences agreed. */}
                <div className="hidden shrink-0 items-center gap-1 @lg:flex">
                  {song.charts.map((chart) => {
                    const style = sourceStyle(chart);
                    return (
                      // Same tone as every other source name — see `source-tag.tsx`. The
                      // chart position rides along, which is what makes this one different
                      // from a plain `<SourceTag>`.
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

                {/* The positions above name the charts; these play from those services. The
                    same names twice, but only on hover — see `ROW_BADGES`. */}
                <SourceBadges song={song} className={ROW_BADGES} />

                <AddToPlaylist
                  song={song}
                  className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                />
              </>
            }
          />
        ))}
      </ul>
    </>
  );
}

/** Who holds the most places — a count of chart slots, not an estimate of listening hours. */
function ArtistsView({
  share,
  total,
}: {
  share: { artist: string; entries: number; best: number }[];
  total: number;
}) {
  const router = useRouter();
  const rows = share.filter((row) => row.entries > 1).slice(0, 15);

  if (rows.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        No artist holds more than one place this week — {total} songs, {total} different names.
      </p>
    );
  }

  return (
    <>
      <p className="mb-4 text-xs leading-relaxed text-[var(--fg-faint)]">
        Out of {total} songs, counted by lead artist only.
      </p>

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

/** How much the charts agree — the measurement the ranking rests on, shown rather than asserted. */
function AgreementView({
  agree,
  rankings,
}: {
  agree: { shared: number; only: { chart: string; count: number }[]; total: number };
  rankings: Rankings;
}) {
  const percent = agree.total > 0 ? Math.round((agree.shared / agree.total) * 100) : 0;

  return (
    <>
      {/* A single number, so it is a figure rather than a one-bar chart. */}
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
        <p className="mt-5 text-xs leading-relaxed text-[var(--fg-faint)]">
          {rankings.failed.map((chart) => sourceStyle(chart).label).join(", ")} did not answer.
        </p>
      )}

      <p className="mt-5 max-w-xl text-xs leading-relaxed text-[var(--fg-faint)]">
        Two agreeing charts beat one asserting — still only two Western services.
      </p>
    </>
  );
}

/** Chart position against popularity. Deezer's chart, since the score is Deezer's own measure. */
function SpreadView({ chart }: { chart: ChartTrack[] }) {
  const { play } = usePlayerControls();

  if (chart.length < 2) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        Deezer&rsquo;s chart did not answer, and the popularity score is its measure — there is
        nothing to plot without it.
      </p>
    );
  }

  return (
    <>
      <p className="mb-4 max-w-2xl text-xs leading-relaxed text-[var(--fg-faint)]">
        Each dot is a song in chart order; height is its catalogue popularity.
      </p>

      <div className="slab rounded-[var(--r-lg)] bg-[var(--surface-1)] p-3 sm:p-4">
        <ChartGraph tracks={chart} onPick={(track) => play(track, chart)} height={220} />
      </div>
    </>
  );
}
