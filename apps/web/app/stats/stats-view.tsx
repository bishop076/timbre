"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

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
import { listeningStats, playsFrom, WEEKDAYS, type ListeningStats } from "./listening-stats";
import { PLAY_LOG_LIMIT, usePlayLog } from "./play-log";

const TOP = 10;

const plural = (value: number, unit: string) => (value === 1 ? unit : `${unit}s`);

const count = (value: number, unit: string) => `${value.toLocaleString()} ${plural(value, unit)}`;

export function StatsView() {
  const hydrated = useHydrated();
  const history = useHistory();
  const log = usePlayLog();
  const stats = useMemo(() => listeningStats(playsFrom(log, history)), [log, history]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-6">
      <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Your listening</h1>
      <Caption className="mt-1.5">Counted in this browser only, from what it has played.</Caption>

      {!hydrated ? (
        <div className="for-you-pending" aria-hidden>
          <Pending />
        </div>
      ) : stats.total === 0 ? (
        <EmptyNotice className="mt-8">
          Nothing played on this device yet. Your most played artists and songs show up here
          once you have{" "}
          <Link href="/" className="font-semibold text-[var(--fg)] hover:underline">
            listened to a few
          </Link>
          .
        </EmptyNotice>
      ) : (
        <Stats stats={stats} capped={log.plays.length >= PLAY_LOG_LIMIT} />
      )}
    </div>
  );
}

function Stats({ stats, capped }: { stats: ListeningStats; capped: boolean }) {
  return (
    <>
      <Notice className="mt-4 max-w-2xl">{describeWindow(stats, capped)}</Notice>

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        <Figure unit="play" value={stats.total} />
        <Figure unit="song" value={stats.songs.length} />
        <Figure unit="artist" value={stats.artists.length} />
        {stats.days > 0 && <Figure unit="day" value={stats.days} />}
      </dl>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
        <div className="flex min-w-0 flex-col gap-10">
          <TopArtists stats={stats} />
          {stats.dated > 0 && <Weekdays stats={stats} />}
        </div>
        <TopSongs stats={stats} />
      </div>
    </>
  );
}

function Figure({ unit, value }: { unit: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-[var(--fg-dim)]">{plural(value, unit)}</dt>
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

      <div>
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

function describeWindow(stats: ListeningStats, capped: boolean): string {
  const one = stats.undated === 1;

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
      <div className="mt-8 grid gap-8 lg:grid-cols-2 lg:gap-10">
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
