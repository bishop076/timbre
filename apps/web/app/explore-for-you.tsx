"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { fetchGenreShelf } from "./genre-shelf";
import { useHydrated } from "./hydrated";
import { EmptyNotice } from "./page-chrome";
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
  const [refused, setRefused] = useState<number[]>([]);
  useEffect(() => () => void (visitSeed += 1), []);

  // Held here rather than in each shelf so one refusal is one notice. Two shelves refusing at
  // once — the ordinary shape of a Deezer rate limit, since they are two reads a moment apart —
  // put two 150px apology boxes above the fold and pushed everything real off a 690px screen.
  // Stable identity, or every render would restart the fetch below it.
  const onRefused = useCallback((id: number) => {
    setRefused((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

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

  // An empty genre list is Deezer refusing, not a catalogue with nothing in it: `deezerList`
  // forgives the refusal into `[]` and nothing downstream can tell. Picks are drawn from that
  // list, so there are none and never will be — and what stood here was two skeleton shelves
  // shimmering for the rest of the visit, a page promising content it already knew it could not
  // fetch. `DiscoverView` says what happened, once, for the whole page; this gets out of its way.
  if (genres.length === 0) return <NewReleases releases={taste.releases} />;

  const missing = picks.filter((pick) => refused.includes(pick.id));

  return (
    <>
      <NewReleases releases={taste.releases} />

      {picks.length === 0
        ? Array.from({ length: SHELVES }, (_, index) => (
            <Shelf key={index} title="For you">
              <TileSkeletons />
            </Shelf>
          ))
        : picks.map((pick) => (
            <GenreShelf
              key={pick.id}
              pick={pick}
              refused={refused.includes(pick.id)}
              onRefused={onRefused}
            />
          ))}

      {missing.length > 0 && (
        <EmptyNotice className="mb-6 @xl:mb-9">
          Deezer wouldn&rsquo;t answer for {listNames(missing.map((pick) => pick.name))} just now,
          so {missing.length === 1 ? "that shelf is" : "those shelves are"} missing rather than
          empty. {missing.length === 1 ? "It fills" : "They fill"} back in the next time you open
          Explore.
        </EmptyNotice>
      )}
    </>
  );
}

function GenreShelf({
  pick,
  refused,
  onRefused,
}: {
  pick: Pick;
  refused: boolean;
  onRefused: (id: number) => void;
}) {
  const [songs, setSongs] = useState<Song[] | null>(null);

  useEffect(() => {
    const aborter = new AbortController();
    fetchGenreShelf(pick.id, aborter.signal)
      .then((found) => {
        if (found === null) onRefused(pick.id);
        setSongs(seededShuffle(found ?? [], Math.random() * 2 ** 32).slice(0, 16));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        onRefused(pick.id);
        setSongs([]);
      });
    return () => aborter.abort();
  }, [pick.id, onRefused]);

  const title = pick.because ? `${pick.name} for you` : `Fresh in ${pick.name}`;

  // A genre Deezer had nothing new in is a shelf worth nobody's screen space. A genre Deezer
  // would not talk about is not the same thing, and taking the shelf away says it was — so the
  // shelf steps aside here and `ExploreForYou` names it in the one notice it keeps for all of
  // them. That notice used to sit under this shelf's own heading, which read well for one refusal
  // and stacked two headed boxes to 330px of a 690px screen for two.
  if (refused) return null;

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
