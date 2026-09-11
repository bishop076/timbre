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

/*
 * The top of Explore: shelves in the genres this browser plays, and what the artists in its
 * history released lately. Someone with no history yet gets two genres drawn at random, so
 * the top of the page is different on every visit rather than the same editorial row.
 */

/** Genre shelves shown. Two: one is a guess, three pushes Featured below the fold. */
const SHELVES = 2;

/** Songs per shelf, dealt from a pool of about fifty. */
const PER_SHELF = 16;

/** Genres never drawn for a stranger — a random "Kids" row reads as a bug, not a surprise. */
const NOT_DRAWN = new Set([0, 95]);

interface Pick {
  id: number;
  name: string;
  /** Who put it there; null for a genre drawn at random. */
  because: string[] | null;
}

/**
 * What this visit's random genres are dealt from. Rolled when the module loads in the
 * browser and moved on by every Explore that unmounts, so coming back to the page draws
 * again. Never read on the server — `useHydrated` gates it — where it would differ from the
 * browser's and the markup would disagree with the first render.
 */
let visitSeed = Math.floor(Math.random() * 2 ** 31);

export function ExploreForYou({ genres }: { genres: Genre[] }) {
  const taste = useTaste();
  const hydrated = useHydrated();
  // Fixed for this mount, so a shelf does not change genre under someone mid-scroll.
  const [seed] = useState(() => visitSeed);
  useEffect(() => () => void (visitSeed += 1), []);

  const nameOf = (id: number) => genres.find((genre) => genre.id === id)?.name ?? null;

  // Personal genres first, topped up with drawn ones it does not already have.
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
        ? // Before the draw: the space the shelves will take, so Featured does not jump down.
          Array.from({ length: SHELVES }, (_, index) => (
            <Shelf key={index} title="For you">
              <TileSkeletons count={8} className={TILE} />
            </Shelf>
          ))
        : picks.map((pick) => <GenreShelf key={pick.id} pick={pick} />)}
    </>
  );
}

/** One genre's new releases and station songs, a different handful each visit. */
function GenreShelf({ pick }: { pick: Pick }) {
  const [songs, setSongs] = useState<Song[] | null>(null);

  useEffect(() => {
    const aborter = new AbortController();
    fetch(`/api/genre-feed?id=${pick.id}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ songs: Song[] }>) : null))
      .then((data) => setSongs(deal(data?.songs ?? [], PER_SHELF)))
      .catch((cause: unknown) => {
        // An abort is this shelf unmounting. Anything else leaves it empty, which hides it.
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setSongs([]);
      });
    return () => aborter.abort();
  }, [pick.id]);

  // A shelf that came back empty says nothing worth a heading.
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
            // Full height of the row rather than square: the song cards beside it are taller
            // than their covers, and a square tile stopped short of them.
            className={`${TILE} tile-card flex items-center justify-center px-3 text-center text-[13px] font-bold text-[var(--fg-dim)] hover:text-[var(--fg)]`}
          >
            All of {pick.name} →
          </Link>
        </>
      )}
    </Shelf>
  );
}

/** What the history's artists put out in the last few months. Nothing, for a new listener. */
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

/** "12 Aug" — the year is implied by "the last four months". Parsed as UTC, as written. */
function when(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** A random `count` of `songs`. Called when the feed arrives, never during render, where a
 * random value would differ between the server's pass and the browser's. */
function deal<T>(songs: T[], count: number): T[] {
  const pool = [...songs];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
