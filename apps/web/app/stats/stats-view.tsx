"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";
import { BarChart } from "../bar-chart";
import { songFromHistory } from "../home-shelves";
import { useHydrated } from "../hydrated";
import { Caption, EmptyNotice, Notice, SectionTitle } from "../page-chrome";
import { useHistory } from "../player/history-store";
import { usePlayerControls } from "../player/player-context";
import { SongRow } from "../song-row";
import { SOURCE_TAG } from "../source-tag";
import { StackedColumns } from "../stacked-columns";
import { useTaste } from "../taste-store";
import {
  DEFAULT_PERIOD,
  genreSpread,
  listeningStats,
  periodByKey,
  PERIODS,
  playsFrom,
  playsOverTime,
  playsWithin,
  WEEKDAYS,
  type GenreSpread,
  type ListeningStats,
  type Period,
  type Timeline,
} from "./listening-stats";
import { PLAY_LOG_LIMIT, usePlayLog } from "./play-log";
import { useNow } from "./use-now";

const TOP = 10;
const TOP_GENRES = 8;

const plural = (value: number, unit: string) => (value === 1 ? unit : `${unit}s`);

const count = (value: number, unit: string) => `${value.toLocaleString()} ${plural(value, unit)}`;

export function StatsView({ genreNames = {} }: { genreNames?: Record<number, string> }) {
  const hydrated = useHydrated();
  const history = useHistory();
  const log = usePlayLog();
  const taste = useTaste();

  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD.key);
  const period = periodByKey(periodKey);

  const now = useNow();

  const everything = useMemo(() => playsFrom(log, history), [log, history]);

  const { stats, timeline } = useMemo(() => {
    const plays = playsWithin(everything, period.days, now);
    return {
      stats: listeningStats(plays),
      timeline: playsOverTime(plays, period.days, now),
    };
  }, [everything, period, now]);

  const spread = useMemo(
    () => genreSpread(stats.artists, taste.genreOf, (id) => genreNames[id]),
    [stats.artists, taste, genreNames],
  );

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-6">
      <div className="flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between @xl:gap-8">
        <div className="min-w-0">
          <h1 className="text-[length:var(--text-title)] font-extrabold tracking-[var(--track-title)]">
            Your listening
          </h1>
          <Caption className="mt-1.5">
            Counted in this browser only, from what it has played.
          </Caption>
        </div>

        {hydrated && now > 0 && everything.length > 0 && (
          <PeriodPicker chosen={period} onChoose={setPeriodKey} />
        )}
      </div>

      {!hydrated || now === 0 ? (
        <div className="for-you-pending" aria-hidden>
          <Pending />
        </div>
      ) : everything.length === 0 ? (
        <NothingYet />
      ) : stats.total === 0 ? (
        <NothingInPeriod period={period} onAllTime={() => setPeriodKey("all")} />
      ) : (
        <Stats
          stats={stats}
          timeline={timeline}
          spread={spread}
          period={period}
          capped={period.days === null && log.plays.length >= PLAY_LOG_LIMIT}
        />
      )}
    </div>
  );
}

/**
 * Three toggle buttons rather than a `role="radiogroup"`.
 *
 * A radio group owns one tab stop and moves between its options with the arrow keys, which is
 * correct and is also a convention nobody expects from a row of filter chips — you press Tab and
 * find yourself past the whole control. Pressed toggles in a named group announce the state and
 * behave the way they look.
 */
function PeriodPicker({
  chosen,
  onChoose,
}: {
  chosen: Period;
  onChoose: (key: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Period to count"
      className="flex shrink-0 gap-1 rounded-[var(--r-full)] bg-[var(--surface-2)] p-1"
    >
      {PERIODS.map((period) => {
        const on = period.key === chosen.key;
        return (
          <button
            key={period.key}
            type="button"
            aria-pressed={on}
            aria-label={period.label}
            onClick={() => onChoose(period.key)}
            className={`press rounded-[var(--r-full)] px-3 py-1.5 text-[length:var(--text-meta)] font-semibold outline-none transition ${
              on
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "text-[var(--fg-dim)] hover:text-[var(--fg)]"
            }`}
          >
            {period.short}
          </button>
        );
      })}
    </div>
  );
}

function Stats({
  stats,
  timeline,
  spread,
  period,
  capped,
}: {
  stats: ListeningStats;
  timeline: Timeline;
  spread: GenreSpread;
  period: Period;
  capped: boolean;
}) {
  return (
    <>
      <Notice className="mt-4 max-w-2xl">{describeWindow(stats, period, capped)}</Notice>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <Figure unit="play" value={stats.total} />
        <Figure unit="song" value={stats.songs.length} />
        <Figure unit="artist" value={stats.artists.length} />
        {stats.activeDays > 0 && (
          <Figure
            unit="day"
            value={stats.activeDays}
            label={`${plural(stats.activeDays, "day")} with a play`}
          />
        )}
      </dl>

      {timeline.buckets.length > 1 && <OverTime timeline={timeline} period={period} />}

      {/* Two columns when *this column of the page* is wide enough, not when the window is.
          The panel these live in is squeezed by the sidebar and again by the now-playing dock,
          so `lg:` split a 648px main into two 290px columns with a bar chart in each. */}
      <div className="mt-10 grid items-start gap-10 @3xl:grid-cols-2 @3xl:gap-10">
        {/* Three short sections against one long one. Top songs is ten rows on its own and runs
            about as tall as the other three stacked, so they go on opposite sides — the other
            arrangement left half a screen of nothing under the left column. */}
        <div className="flex min-w-0 flex-col gap-10">
          <TopArtists stats={stats} />
          {stats.dated > 0 && <Weekdays stats={stats} />}
          <Genres spread={spread} />
        </div>
        <TopSongs stats={stats} />
      </div>
    </>
  );
}

function Figure({ unit, value, label }: { unit: string; value: number; label?: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[length:var(--text-meta)] text-[var(--fg-dim)]">
        {label ?? plural(value, unit)}
      </dt>
      <dd className="text-[length:var(--text-display)] font-extrabold leading-none tabular-nums tracking-[var(--track-display)]">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function OverTime({ timeline, period }: { timeline: Timeline; period: Period }) {
  const grain = timeline.grain === "day" ? "day" : timeline.grain === "week" ? "week" : "month";
  const busiest = timeline.buckets.reduce((best, bucket) =>
    bucket.plays > best.plays ? bucket : best,
  );

  return (
    <section className="mt-9 min-w-0">
      <SectionTitle>Listening over time</SectionTitle>
      <Caption className="mb-4 mt-1 max-w-2xl">
        Plays per {grain}, in this device&rsquo;s time zone. Quiet {grain}s are kept — a gap is
        the part worth seeing.
        {busiest.plays > 0 && ` Your busiest was ${busiest.label}, with ${count(busiest.plays, "play")}.`}
        {timeline.undated > 0 &&
          ` ${count(timeline.undated, "play")} from before Timbre kept times ${timeline.undated === 1 ? "is" : "are"} left out.`}
      </Caption>

      <StackedColumns
        columns={timeline.buckets.map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          axis: bucket.axis,
          total: bucket.plays,
          values: [bucket.plays],
        }))}
        segments={["Plays"]}
        unit="play"
        rowLabel={grain === "day" ? "Day" : grain === "week" ? "Week" : "Month"}
        caption={`Plays per ${grain} over ${period.label.toLowerCase()}`}
      />
    </section>
  );
}

function TopArtists({ stats }: { stats: ListeningStats }) {
  const router = useRouter();
  const top = stats.artists.slice(0, TOP);

  return (
    <section className="@container min-w-0">
      <SectionTitle>Top artists</SectionTitle>
      <Caption className="mb-3 mt-1">A song with two artists counts for both.</Caption>

      {top.length === 0 ? (
        <Notice>None of what you played named an artist.</Notice>
      ) : (
        <BarChart
          rows={top.map((artist) => ({
            key: artist.key,
            label: artist.name,
            value: artist.plays,
            note: `${artist.songs} ${artist.songs === 1 ? "song" : "different songs"}`,
          }))}
          unit="play"
          pickHint="Go to the artist"
          onPick={(key) => {
            const artist = top.find((entry) => entry.key === key);
            if (artist) router.push(`/artist/${toArtistSlug(artist.name)}`);
          }}
        />
      )}
    </section>
  );
}

function TopSongs({ stats }: { stats: ListeningStats }) {
  const { play, current, state } = usePlayerControls();
  const top = stats.songs.slice(0, TOP);
  const songs = top.map((entry) => songFromHistory(entry.song));

  return (
    <section className="@container min-w-0">
      <SectionTitle>Top songs</SectionTitle>
      <Caption className="mb-3 mt-1">Playing one queues the rest of the list after it.</Caption>

      <ul className="divide-y divide-[var(--line)]">
        {top.map((entry, index) => {
          const song = songs[index]!;
          return (
            <SongRow
              key={song.id}
              song={song}
              onPlay={() => play(song, songs)}
              isCurrent={current?.id === song.id}
              isPlaying={state === "playing"}
              size="sm"
              rank={index + 1}
              rankPlays
              subtitle={<ArtistLink artists={song.artists} />}
              trailing={
                <span className={`${SOURCE_TAG} mr-1 shrink-0 tabular-nums`}>
                  {entry.plays} {plural(entry.plays, "play")}
                </span>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

function Weekdays({ stats }: { stats: ListeningStats }) {
  return (
    <section className="min-w-0">
      <SectionTitle>When you listen</SectionTitle>
      <Caption className="mb-4 mt-1 max-w-2xl">
        Plays by day of the week, in this device&rsquo;s time zone.
        {stats.undated > 0 &&
          ` ${stats.undated === 1 ? "The one song" : `The ${stats.undated} songs`} from before Timbre kept times ${stats.undated === 1 ? "is" : "are"} left out.`}
      </Caption>

      <StackedColumns
        columns={WEEKDAYS.map((day, index) => {
          const plays = stats.weekdays[index] ?? 0;
          return { key: day, label: day, total: plays, values: [plays] };
        })}
        segments={["Plays"]}
        unit="play"
        rowLabel="Day"
        caption="Plays by day of the week"
      />
    </section>
  );
}

function Genres({ spread }: { spread: GenreSpread }) {
  const top = spread.genres.slice(0, TOP_GENRES);
  const total = spread.placed + spread.unplaced;

  return (
    <section className="@container min-w-0">
      <SectionTitle>Genre spread</SectionTitle>
      <Caption className="mb-3 mt-1 max-w-2xl">
        By the genre of the artist played, so a song with two artists counts for both. Timbre has
        no genres of its own — it looks a few artists up as you listen and keeps the answers on
        this device.
      </Caption>

      {top.length === 0 ? (
        <Notice>
          {total === 0
            ? "Nothing to place yet."
            : "No artist from this period has been looked up yet. Keep listening and the genres fill in."}
        </Notice>
      ) : (
        <>
          <BarChart
            rows={top.map((genre) => ({
              key: String(genre.id),
              label: genre.name,
              value: genre.plays,
              note: genre.artists.join(", "),
            }))}
            unit="play"
          />
          {spread.unplaced > 0 && (
            <Caption className="mt-3">
              {spread.unplaced.toLocaleString()} of {count(total, "play")} could not be placed —
              those artists have not been looked up yet.
            </Caption>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The first thing a new listener sees, so it has to read as the beginning of something rather
 * than as a page that failed to load. The old one was a grey slab holding one sentence in the
 * middle of an otherwise empty screen; it said what was missing and offered nothing.
 */
function NothingYet() {
  return (
    <div className="mt-8 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-6 py-10 text-center sm:px-10 sm:py-12">
      <p className="text-[length:var(--text-title)] font-extrabold tracking-[var(--track-title)]">
        Nothing counted yet
      </p>
      <p className="mx-auto mt-2.5 max-w-lg text-[length:var(--text-body)] leading-relaxed text-[var(--fg-dim)]">
        Play a few songs and this page fills in on its own: your top artists and songs, how much
        you listened each day, and the genres you keep coming back to.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/explore"
          className="press slab-sm inline-flex items-center rounded-[var(--r-full)] bg-[var(--accent)] px-5 py-2.5 text-[length:var(--text-body)] font-bold text-[var(--accent-fg)] outline-none"
        >
          Find something to play
        </Link>
        <Link
          href="/"
          className="press slab-sm inline-flex items-center rounded-[var(--r-full)] bg-[var(--surface-3)] px-5 py-2.5 text-[length:var(--text-body)] font-bold outline-none"
        >
          Go home
        </Link>
      </div>

      <p className="mx-auto mt-6 max-w-md text-[length:var(--text-meta)] leading-relaxed text-[var(--fg-faint)]">
        The tally is kept in this browser and nowhere else. Clear the site data and it is gone.
      </p>
    </div>
  );
}

/** Listened before, but not in the window they picked — a different thing from never having. */
function NothingInPeriod({ period, onAllTime }: { period: Period; onAllTime: () => void }) {
  return (
    <EmptyNotice className="mt-8">
      Nothing played in {period.label.toLowerCase()}.{" "}
      <button
        type="button"
        onClick={onAllTime}
        className="press rounded-[var(--r-sm)] font-semibold text-[var(--fg)] outline-none hover:underline"
      >
        Count all time
      </button>{" "}
      instead, or{" "}
      <Link href="/explore" className="font-semibold text-[var(--fg)] hover:underline">
        find something to play
      </Link>
      .
    </EmptyNotice>
  );
}

function describeWindow(stats: ListeningStats, period: Period, capped: boolean): string {
  const one = stats.undated === 1;

  if (period.days !== null) {
    const days =
      stats.activeDays === 1
        ? " — all on one day"
        : ` — on ${count(stats.activeDays, "day")} of them`;
    return `${count(stats.total, "play")} in ${period.label.toLowerCase()}${days}.`;
  }

  if (stats.first === null || stats.last === null) {
    const songs = one ? "The one song" : `The last ${count(stats.undated, "song")}`;
    return `${songs} you played. Timbre has only just started counting plays on this device, so each counts once for now — the numbers fill in as you listen.`;
  }

  const from = formatDate(stats.first);
  const to = formatDate(stats.last);
  const range = from === to ? `on ${from}` : `from ${from} to ${to}`;

  if (capped) {
    return `Your last ${count(stats.dated, "play")}, ${range}. Older plays make room for new ones, so this is always your recent listening.`;
  }

  const since = `${count(stats.dated, "play")} ${range}.`;
  if (stats.undated === 0) return since;
  const rest = one ? "the one song" : `the ${count(stats.undated, "song")}`;
  return `${since} Timbre started counting plays on ${from}; before that it kept only which songs you played, so ${rest} you have not played since ${one ? "counts" : "count"} once.`;
}

function formatDate(at: number): string {
  const date = new Date(at);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

const pulse = (size: string) => `${size} animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]`;

function Pending() {
  return (
    <>
      <div className={pulse("mt-4 h-4 w-2/3 max-w-md")} />
      <div className="mt-6 flex gap-10">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={pulse("h-12 w-16")} />
        ))}
      </div>
      <div className={pulse("mt-9 h-40 w-full")} />
      <div className="mt-10 grid gap-8 @3xl:grid-cols-2 @3xl:gap-10">
        {Array.from({ length: 2 }, (_, column) => (
          <div key={column} className="flex flex-col gap-2">
            <div className={pulse("mb-2 h-6 w-32")} />
            {Array.from({ length: 6 }, (_, row) => (
              <div key={row} className={pulse("h-6")} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
