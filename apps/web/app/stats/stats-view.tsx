"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";
import { BarChart } from "../bar-chart";
import { songFromHistory } from "../home-shelves";
import { useHydrated } from "../hydrated";
import { useHistory } from "../player/history-store";
import { usePlayerControls } from "../player/player-context";
import { SongRow } from "../song-row";
import { SOURCE_TAG } from "../source-tag";
import { StackedColumns } from "../stacked-columns";
import { listeningStats, playsFrom, WEEKDAYS, type ListeningStats } from "./listening-stats";
import { PLAY_LOG_LIMIT, usePlayLog } from "./play-log";

/** Rows per list. Ten is a top ten; past it the counts are mostly ones. */
const TOP = 10;

/**
 * "Your listening" — top artists, top songs and the days you play, counted from this
 * browser's own plays. Nothing is sent anywhere to work it out, and nothing here is shared
 * with another device.
 */
export function StatsView() {
  const hydrated = useHydrated();
  const history = useHistory();
  const log = usePlayLog();
  const stats = useMemo(() => listeningStats(playsFrom(log, history)), [log, history]);
  const capped = log.plays.length >= PLAY_LOG_LIMIT;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-6">
      <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Your listening</h1>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-faint)]">
        Counted in this browser only, from what it has played.
      </p>

      {/* Both stores read empty until hydration, and "nothing played yet" is a real answer
          here, so the server's render must not give it. A returning listener gets the
          space the figures will take — `.for-you-pending` is shown only when the boot
          script found a history — and a first visit gets nothing until storage answers. */}
      {!hydrated ? (
        <div className="for-you-pending" aria-hidden>
          <Pending />
        </div>
      ) : stats.total === 0 ? (
        <p className="mt-8 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          Nothing played on this device yet. Your most played artists and songs show up here
          once you have{" "}
          <Link href="/" className="font-semibold text-[var(--fg)] hover:underline">
            listened to a few
          </Link>
          .
        </p>
      ) : (
        <Stats stats={stats} capped={capped} />
      )}
    </div>
  );
}

function Stats({ stats, capped }: { stats: ListeningStats; capped: boolean }) {
  return (
    <>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--fg-dim)]">
        {describeWindow(stats, capped)}
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <Figure label={stats.total === 1 ? "play" : "plays"} value={stats.total} />
        <Figure label={stats.songs.length === 1 ? "song" : "songs"} value={stats.songs.length} />
        <Figure
          label={stats.artists.length === 1 ? "artist" : "artists"}
          value={stats.artists.length}
        />
        {stats.days > 0 && <Figure label={stats.days === 1 ? "day" : "days"} value={stats.days} />}
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-10">
        <TopArtists stats={stats} />
        <TopSongs stats={stats} />
      </div>

      {stats.dated > 0 && <Weekdays stats={stats} />}
    </>
  );
}

/** One headline number. A figure rather than a chart — a single value has nothing to compare. */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-[var(--fg-dim)]">{label}</dt>
      <dd className="text-3xl font-extrabold tabular-nums tracking-tight">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function TopArtists({ stats }: { stats: ListeningStats }) {
  const router = useRouter();
  const top = stats.artists.slice(0, TOP);

  return (
    // Its own container: `BarChart` sizes its labels against the nearest one, and the page
    // is two columns wide on a desktop.
    <section className="@container min-w-0">
      <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">Top artists</h2>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-[var(--fg-faint)]">
        A song with two artists counts for both.
      </p>

      {top.length === 0 ? (
        <p className="text-sm leading-relaxed text-[var(--fg-dim)]">
          None of what you played named an artist.
        </p>
      ) : (
        <BarChart
          rows={top.map((artist) => ({
            key: artist.key,
            label: artist.name,
            value: artist.plays,
            note: `${artist.songs} ${artist.songs === 1 ? "song" : "different songs"}`,
          }))}
          unit="play"
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
  // Rebuilt the way every other history shelf rebuilds them, so a song plays from the source
  // it played on last time rather than being searched for by title.
  const songs = top.map((entry) => songFromHistory(entry.song));

  return (
    <section className="@container min-w-0">
      <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">Top songs</h2>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-[var(--fg-faint)]">
        Playing one queues the rest of the list after it.
      </p>

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
                  {entry.plays} {entry.plays === 1 ? "play" : "plays"}
                </span>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

/** Plays by day of the week — the one question the times answer that the lists do not. */
function Weekdays({ stats }: { stats: ListeningStats }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">When you listen</h2>
      <p className="mb-4 mt-1 max-w-2xl text-xs leading-relaxed text-[var(--fg-faint)]">
        Plays by day of the week, in this device&rsquo;s time zone.
        {stats.undated > 0 &&
          ` ${stats.undated === 1 ? "The one song" : `The ${stats.undated} songs`} from before Timbre kept times ${stats.undated === 1 ? "is" : "are"} left out.`}
      </p>

      <div className="max-w-2xl">
        <StackedColumns
          columns={WEEKDAYS.map((day, index) => {
            const plays = stats.weekdays[index] ?? 0;
            return { label: day, total: plays, values: [plays] };
          })}
          segments={["Plays"]}
          unit="play"
        />
      </div>
    </section>
  );
}

/**
 * Which plays these are, said plainly — never "all time". The log is capped, and before it
 * existed the history kept which songs were played but not how often.
 */
function describeWindow(stats: ListeningStats, capped: boolean): string {
  const count = (value: number, unit: string) =>
    `${value.toLocaleString()} ${value === 1 ? unit : `${unit}s`}`;

  if (stats.first === null || stats.last === null) {
    const songs = stats.undated === 1 ? "The one song" : `The last ${count(stats.undated, "song")}`;
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
  const rest = stats.undated === 1 ? "the one song" : `the ${count(stats.undated, "song")}`;
  return `${since} Timbre started counting plays on ${from}; before that it kept only which songs you played, so ${rest} you have not played since ${stats.undated === 1 ? "counts" : "count"} once.`;
}

/** "3 Sep", with the year only when it is not this one. */
function formatDate(at: number): string {
  const date = new Date(at);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The space the figures and lists take, for a returning listener before storage is read. */
function Pending() {
  return (
    <>
      <div className="mt-4 h-4 w-2/3 max-w-md animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
      <div className="mt-6 flex gap-10">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-12 w-16 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
        ))}
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-10">
        {Array.from({ length: 2 }, (_, column) => (
          <div key={column} className="flex flex-col gap-2">
            <div className="mb-2 h-6 w-32 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
            {Array.from({ length: 6 }, (_, row) => (
              <div key={row} className="h-6 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
