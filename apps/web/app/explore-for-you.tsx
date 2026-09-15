"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchGenreShelf } from "./genre-shelf";
import { useHydrated } from "./hydrated";
import { EmptyNotice, SectionHeader } from "./page-chrome";
import { Shelf } from "./shelf";
import { SongTiles, TILE } from "./song-card";
import { useTaste } from "./taste-store";
import { ReleaseCard } from "./tile-cards";
import { TileSkeletons } from "./tile-skeleton";
import type { Song } from "./types";
import type { Genre } from "@/lib/discover";
import { listNames } from "@/lib/genre-tally";
import { seededShuffle } from "@/lib/rotation";

const SHELVES = 2;
const NOT_DRAWN = new Set([0, 95]);

type Pick = { id: number; name: string; because: string[] | null };

let visitSeed = Math.floor(Math.random() * 2 ** 31);

export function kindLabel(kind: string): string {
  return kind === "single" ? "Single" : kind === "ep" ? "EP" : "Album";
}

export function ExploreForYou({ genres }: { genres: Genre[] }) {
  const taste = useTaste();
  const hydrated = useHydrated();
  const [seed] = useState(() => visitSeed);
  useEffect(() => () => void (visitSeed += 1), []);

  const picks: Pick[] = taste.genres
    .flatMap((genre) => {
      const name = genres.find((entry) => entry.id === genre.id)?.name;
      return name ? [{ id: genre.id, name, because: genre.artists }] : [];
    })
    .slice(0, SHELVES);

  if (hydrated) {
    for (const genre of seededShuffle(genres.filter((entry) => !NOT_DRAWN.has(entry.id)), seed)) {
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
              <TileSkeletons />
            </Shelf>
          ))
        : picks.map((pick) => <GenreShelf key={pick.id} pick={pick} />)}
    </>
  );
}

function GenreShelf({ pick }: { pick: Pick }) {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    const aborter = new AbortController();
    fetchGenreShelf(pick.id, aborter.signal)
      .then((found) => {
        setRefused(found === null);
        setSongs(seededShuffle(found ?? [], Math.random() * 2 ** 32).slice(0, 16));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setRefused(true);
        setSongs([]);
      });
    return () => aborter.abort();
  }, [pick.id]);

  const title = pick.because ? `${pick.name} for you` : `Fresh in ${pick.name}`;

  // A genre Deezer had nothing new in is a shelf worth nobody's screen space. A genre Deezer
  // would not talk about is not the same thing, and taking the shelf away says it was.
  if (refused) {
    return (
      <section aria-label={title} className="mb-6 @xl:mb-9">
        <SectionHeader title={title}>{null}</SectionHeader>
        <EmptyNotice>
          Deezer wouldn&rsquo;t answer for {pick.name} just now, so this shelf is missing rather
          than empty. It fills itself the next time you open Explore.
        </EmptyNotice>
      </section>
    );
  }

  if (songs !== null && songs.length === 0) return null;

  return (
    <Shelf
      title={title}
      caption={
        pick.because ? `Because you play ${listNames(pick.because.slice(0, 2))}` : undefined
      }
    >
      {songs === null ? (
        <TileSkeletons />
      ) : (
        <>
          <SongTiles songs={songs} />
          <Link
            href={`/collection/genre/${pick.id}`}
            className={`${TILE} press flex aspect-square self-start items-center justify-center rounded-[var(--r-lg)] bg-[var(--surface-2)] px-3 text-center text-[13px] font-bold text-[var(--fg-dim)] hover:text-[var(--fg)]`}
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
      {releases.slice(0, 16).map((release, index) => (
        <div key={release.id} className={TILE}>
          <ReleaseCard
            href={`/album/${release.id}`}
            coverUrl={release.coverUrl}
            // The first shelf on /explore, so these are the covers on screen when the page
            // arrives. Lazy-loading them is what made a shelf turn up as a row of empty boxes.
            eager={index < 6}
            title={release.title}
            subtitle={`${release.artist} · ${kindLabel(release.kind)} · ${when(release.date)}`}
          />
        </div>
      ))}
    </Shelf>
  );
}

function when(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}
