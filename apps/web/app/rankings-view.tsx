"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { toArtistSlug } from "./artist-slug";
import { NoteIcon, PlayIcon } from "./icons";
import { Movement } from "./movement";
import { usePlayer } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { sourceStyle } from "./sources";
import { StackedColumns } from "./stacked-columns";

// Fetched when a tab opens; `StackedColumns` stays static as the default view. The split
// must be here, not `explore/page.tsx` — this Next version won't code-split a Client
// Component that a Server Component imports dynamically.
const BarChart = dynamic(() => import("./bar-chart").then((m) => m.BarChart));
const ChartGraph = dynamic(() => import("./chart-graph").then((m) => m.ChartGraph));
import type { ChartTrack } from "@/lib/discover";
import { RANK_BANDS } from "@/lib/rank-bands";
import type { GenreMix, Rankings } from "@/lib/rankings";
import { cover as coverSrc } from "./artwork-url";

/*
 * Rankings — a rail of views down the side. No source publishes chart history keyless and
 * there is no server to accumulate it, so every view is one week's standings, never a
 * trend. Movement is the exception, and labelled personal.
 */

/** Snapshot key for the fused ranking. Named, not a bare `-1` — see `chart-memory.ts`. */
const FUSED_RANKING = -1;

type ViewId = "mix" | "spread" | "songs" | "artists" | "agreement";

const VIEWS: { id: ViewId; label: string; blurb: string }[] = [
  { id: "mix", label: "Genre mix", blurb: "Which genres feed the chart, and how high they land" },
  { id: "spread", label: "Popularity", blurb: "Chart position against catalogue popularity" },
  { id: "songs", label: "Top songs", blurb: "Ranked across every chart at once" },
  { id: "artists", label: "Top artists", blurb: "Who holds the most places" },
  { id: "agreement", label: "Chart agreement", blurb: "Where the sources disagree" },
];

export function RankingsView({
  rankings,
  share,
  agree,
  mix,
  chart,
  embedded = false,
}: {
  rankings: Rankings;
  share: { artist: string; entries: number; best: number }[];
  agree: { shared: number; only: { chart: string; count: number }[]; total: number };
  mix: GenreMix[];
  chart: ChartTrack[];
  /** Rendered inside another page rather than as one. Explore embeds it; `/rankings` is the direct link. */
  embedded?: boolean;
}) {
  // The graph leads: a rankings page that opens on a list is a list with a menu.
  const [view, setView] = useState<ViewId>(mix.length > 0 ? "mix" : "songs");
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
                onClick={() => setView(entry.id)}
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
            {view === "mix" && <GenreMixView mix={mix} />}
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

function SongsView({ rankings }: { rankings: Rankings }) {
  const { play, current, state } = usePlayer();
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
        {songs.slice(0, 50).map((song) => {
          const isCurrent = current?.id === song.id;
          const moved = movementOf(snapshot, song.id, song.position);

          return (
            <li
              key={song.id}
              className={`group flex items-center gap-2.5 rounded-lg px-2 transition sm:gap-3 ${
                isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
              }`}
            >
              <button
                type="button"
                onClick={() => play(song, songs)}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left focus:outline-none sm:gap-3"
                aria-label={`Play ${song.title}`}
              >
                <span className="w-6 shrink-0 text-right text-[13px] font-bold tabular-nums text-[var(--fg-faint)]">
                  {song.position}
                </span>

                <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-[var(--surface-1)]">
                  {song.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                    <img
                      src={coverSrc(song.artworkUrl, 112) ?? undefined}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-[var(--fg-dim)]">
                      <NoteIcon className="size-4" />
                    </span>
                  )}
                  <span
                    className={`absolute inset-0 flex items-center justify-center bg-black/55 transition ${
                      isCurrent && state === "playing"
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    }`}
                  >
                    <PlayIcon className="size-4 text-white" />
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[14px] font-medium ${isCurrent ? "text-[var(--accent)]" : ""}`}
                  >
                    {song.title}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--fg-dim)]">
                    {song.artists.join(", ")}
                  </span>
                </span>
              </button>

              <Movement delta={moved} />

              {/* Which charts carried it, and where — a badge pair means two audiences agreed. */}
              <div className="hidden shrink-0 items-center gap-1 @lg:flex">
                {song.charts.map((chart) => {
                  const style = sourceStyle(chart);
                  return (
                    <span
                      key={chart}
                      title={`#${song.positions[chart]} on ${style.label}`}
                      style={{ color: style.color, backgroundColor: style.tint }}
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                    >
                      {style.short} #{song.positions[chart]}
                    </span>
                  );
                })}
              </div>

              <AddToPlaylist
                song={song}
                className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
              />
            </li>
          );
        })}
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

function GenreMixView({ mix }: { mix: GenreMix[] }) {
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

/** Chart position against popularity. Deezer's chart, since the score is Deezer's own measure. */
function SpreadView({ chart }: { chart: ChartTrack[] }) {
  const { play } = usePlayer();

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
