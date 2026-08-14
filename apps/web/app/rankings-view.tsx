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

/**
 * The graphs behind a tab, fetched when that tab is opened.
 *
 * `StackedColumns` stays a static import because it draws the *default* view —
 * lazy-loading the thing that renders on arrival would only add a fetch to the
 * critical path. `BarChart` (Artists, Agreement) and `ChartGraph` (Spread) are
 * each one click away.
 *
 * The boundary has to be here rather than in `explore/page.tsx`: this Next
 * version does not code-split a Client Component that a Server Component
 * imports dynamically, and Explore's page is a server component.
 */
const BarChart = dynamic(() => import("./bar-chart").then((m) => m.BarChart));
const ChartGraph = dynamic(() => import("./chart-graph").then((m) => m.ChartGraph));
import type { ChartTrack } from "@/lib/discover";
import { RANK_BANDS } from "@/lib/rank-bands";
import type { GenreMix, Rankings } from "@/lib/rankings";
import { cover as coverSrc } from "./artwork-url";

/**
 * Rankings — the charts, and the working behind them.
 *
 * Shaped after OpenRouter's rankings page: a rail of topics down the side, one
 * view at a time beside it. That arrangement is worth copying because it admits
 * something most chart pages hide — that "top" is a choice of measurement, and
 * a different choice gives a different list. Naming each view is what lets a
 * reader see which one they are being shown.
 *
 * **What could not be copied, and why.** OpenRouter's headline chart is a year
 * of weekly usage. It can draw that because it *is* the thing being measured —
 * every request goes through it. Timbre measures nothing: no source publishes
 * chart history without credentials, and there is no server here to accumulate
 * it in. So every view below is a slice of one week's standings, never a trend,
 * and the page says so rather than drawing a line through a single point.
 *
 * The one exception is movement, which is genuinely over time — because your
 * own browser kept the last reading. It is labelled as personal wherever it
 * appears.
 */

/**
 * The snapshot key for the fused ranking.
 *
 * Named, because it used to be a bare `-1` written here and read by the
 * collection page — see `chart-memory.ts` for what that produced.
 */
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
  /**
   * Rendered inside another page rather than as one.
   *
   * Explore has room for this and `/rankings` still exists for the direct link,
   * so one component serves both — an embedded copy that drifted from the page
   * version would be two rankings that disagree.
   */
  embedded?: boolean;
}) {
  // The graph leads, the way OpenRouter's page does — a rankings page that
  // opens on a list is a list with a menu beside it.
  const [view, setView] = useState<ViewId>(mix.length > 0 ? "mix" : "songs");
  const current = VIEWS.find((entry) => entry.id === view)!;

  /*
   * The failure state has to respect `embedded` too.
   *
   * It did not, and every chart source being down was the one moment the bug
   * showed: Explore already opens with an `<h1>Explore</h1>`, so this rendered a
   * *second* top-level heading on the same page, wrapped in the page padding
   * and max-width of a route it is not — a band of content indented inside a
   * container that had already indented it.
   *
   * The same two decisions as the success path below, for the same reasons.
   */
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
          Chips that wrap on a phone, a column on a wide screen.

          They used to scroll sideways, which meant the last one or two were
          simply cut off at the panel edge with nothing to say they were there —
          "Top artists" arrived as "Top a" against a hard edge, which reads as
          broken rather than as scrollable. Five short labels wrap into two tidy
          rows and every one of them is visible without a gesture.
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

/** The fused ranking, with the evidence for each position beside it. */
function SongsView({ rankings }: { rankings: Rankings }) {
  const { play, current, state } = usePlayer();
  const songs = rankings.songs;

  /*
   * Movement uses a reserved key rather than a genre id.
   *
   * This is the fused ranking, not Deezer's chart, so comparing it against the
   * snapshot taken on a genre page would report movement that never happened —
   * two different orders differ everywhere. Genre ids are non-negative, so a
   * negative key cannot collide with one.
   */
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

              {/*
                Which charts carried it, and where. This is the whole argument
                for the ranking: a badge pair means two independent audiences
                put it here, and one badge means one did.
              */}
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

/**
 * Who holds the most places.
 *
 * The honest version of "market share": a count of slots on a board of a known
 * size, not an estimate of listening hours. Nobody publishes hours for free,
 * and a number invented to fill that column would be the only untrue thing on
 * the page.
 */
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

/**
 * How much the charts agree.
 *
 * This is the measurement the ranking rests on, so it is shown rather than
 * asserted. If almost nothing appears on both charts, then "consensus" is
 * really two lists interleaved — and a reader is owed that, not a page that
 * quietly claims more rigour than the data supports.
 */
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

/**
 * The stacked column chart: which genres feed the chart, and how high.
 *
 * The nearest honest answer to OpenRouter's headline graph. Theirs plots a year
 * of weekly usage because they log every request; this plots genre against
 * placings because that is a measurement that exists. Same form, different
 * axis, and the caption says which.
 */
function GenreMixView({ mix }: { mix: GenreMix[] }) {
  if (mix.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
        No genre chart overlapped the ranking this week. Genre charts come from Deezer, and either
        it did not answer or none of its genre entries reached the fused top 100.
      </p>
    );
  }

  /*
   * Eight, not twelve.
   *
   * The chart is no longer a scroll box — it fits whatever width it is given —
   * so the number of columns now decides how thin each one gets. Twelve on a
   * phone is a row of slivers under labels that are all ellipsis. Eight is the
   * most that stays legible at the narrowest size the app supports, and the
   * genres beyond it are the ones contributing one or two songs.
   */
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

/**
 * Chart position against catalogue popularity.
 *
 * Deezer's chart rather than the fused ranking, and labelled as such — the
 * popularity score is Deezer's measure of a Deezer recording, and presenting it
 * over a ranking built from two catalogues would be claiming a number that
 * neither of them published.
 *
 * A dot plot, not bars. The scores sit in a narrow band near the top of their
 * range, and a bar has to grow from zero or its length lies — from zero these
 * are twenty-five near-identical blocks. See `chart-graph.tsx`.
 */
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
