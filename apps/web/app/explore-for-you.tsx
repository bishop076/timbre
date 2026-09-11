"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useHydrated } from "./hydrated";
import { Shelf } from "./shelf";
import { SongCard, TILE } from "./song-card";
import { useTaste } from "./taste-store";
import { ReleaseCard } from "./tile-cards";
import { TileSkeletons } from "./tile-skeleton";
import type { Song } from "./types";
import type { Genre } from "@/lib/discover";
import { listNames } from "@/lib/genre-tally";
import { seededShuffle } from "@/lib/rotation";

const SHELVES = 2;

const PER_SHELF = 16;

const NOT_DRAWN = new Set([0, 95]);

interface Pick {
  id: number;
  name: string;
  because: string[] | null;
}

let visitSeed = Math.floor(Math.random() * 2 ** 31);

export function ExploreForYou({ genres }: { genres: Genre[] }) {
  const taste = useTaste();
  const hydrated = useHydrated();
  const [seed] = useState(() => visitSeed);
  useEffect(() => () => void (visitSeed += 1), []);

  const nameOf = (id: number) => genres.find((genre) => genre.id === id)?.name ?? null;

  const picks: Pick[] = [];
  for (const genre of taste.genres) {
    const name = nameOf(genre.id);
    if (name && picks.length < SHELVES) picks.push({ id: genre.id, name, because: genre.artists });
  }
  if (hydrated) {
    const pool = seededShuffle(
      genres.filter((genre) => !NOT_DRAWN.has(genre.id)),
      seed,
    );
    for (const genre of pool) {
      if (picks.length >= SHELVES) break;
      if (!picks.some((pick) => pick.id === genre.id)) {
        picks.push({ id: genre.id, name: genre.name, because: null });
      }
    }
  }

  return (
    <>
      <NewReleases releases={taste.releases} />

      {picks.length === 0
        ? Array.from({ length: SHELVES }, (_, index) => (
            <Shelf key={index} title="For you">
              <TileSkeletons count={8} className={TILE} />
            </Shelf>
          ))
        : picks.map((pick) => <GenreShelf key={pick.id} pick={pick} />)}
    </>
  );
}

function GenreShelf({ pick }: { pick: Pick }) {
  const [songs, setSongs] = useState<Song[] | null>(null);

  useEffect(() => {
    const aborter = new AbortController();
    fetch(`/api/genre-feed?id=${pick.id}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ songs: Song[] }>) : null))
      .then((data) => setSongs(deal(data?.songs ?? [], PER_SHELF)))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setSongs([]);
      });
    return () => aborter.abort();
  }, [pick.id]);

  if (songs !== null && songs.length === 0) return null;

  const title = pick.because ? `${pick.name} for you` : `Fresh in ${pick.name}`;
  const caption = pick.because
    ? `Because you play ${listNames(pick.because.slice(0, 2))}`
    : "New releases and station picks";

  return (
    <Shelf title={title} caption={caption}>
      {songs === null ? (
        <TileSkeletons count={8} className={TILE} />
      ) : (
        <>
          {songs.map((song) => (
            <div key={song.id} className={TILE}>
              <SongCard song={song} queue={songs} />
            </div>
          ))}
          <Link
            href={`/collection/genre/${pick.id}`}
            className={`${TILE} tile-card flex items-center justify-center px-3 text-center text-[13px] font-bold text-[var(--fg-dim)] hover:text-[var(--fg)]`}
          >
            All of {pick.name} →
          </Link>
        </>
      )}
    </Shelf>
  );
}

function NewReleases({ releases }: { releases: ReturnType<typeof useTaste>["releases"] }) {
  if (releases.length === 0) return null;

  return (
    <Shelf title="New from artists you play" caption="The last four months">
      {releases.slice(0, 16).map((release) => (
        <div key={release.id} className={TILE}>
          <ReleaseCard
            href={`/album/${release.id}`}
            coverUrl={release.coverUrl}
            title={release.title}
            subtitle={`${release.artist} · ${kindLabel(release.kind)} · ${when(release.date)}`}
          />
        </div>
      ))}
    </Shelf>
  );
}

function kindLabel(kind: string): string {
  return kind === "single" ? "Single" : kind === "ep" ? "EP" : "Album";
}

function when(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function deal<T>(songs: T[], count: number): T[] {
  const pool = [...songs];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
