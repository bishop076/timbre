"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cover as coverSrc } from "./artwork-url";
import { Collage } from "./collage";
import { ShuffleIcon } from "./icons";
import { Shelf } from "./shelf";
import type { Discover } from "@/lib/discover";
import type { Radio } from "@/lib/radios";

/** Explore — Featured cards, rows of pills, then the charts. All Deezer's and keyless;
 * picking a track resolves a copy Timbre can actually drive. */
export function DiscoverView({
  initial,
  radios,
  rankings,
}: {
  initial: Discover;
  radios: Radio[];
  /* The charts already rendered, not the data: as props the page had to await the slowest
   * thing on it first. A `ReactNode` because a client file cannot import a server one. */
  rankings: ReactNode;
}) {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Explore</h1>

      {/* Keeps the charts heading below the fold at any size. The subtraction is chrome this
          page does not own; 12rem over-allowed and left half a heading peeking over the edge. */}
      <div className="min-h-[calc(100dvh-9rem)]">
        <Featured data={initial} />

        <PillSection
          title="Genres"
          // `0` is the catalogue-wide chart, already the first Featured card.
          pills={initial.genres
            .filter((entry) => entry.id !== 0)
            .map((entry) => ({
              key: String(entry.id),
              label: entry.name,
              href: `/collection/genre/${entry.id}`,
            }))}
          initial={9}
          shuffleable
        />

        {/* Only words, sent to Deezer's playlist search when pressed — see `lib/radios.ts`.
            One row, not one per genre: grouping put "Pop" as a heading directly under the
            same word as a pill. */}
        <PillSection
          title="Stations"
          pills={interleave(radios).map((radio) => ({
            key: String(radio.id),
            label: radio.title,
            href: `/collection/radio/${radio.id}`,
          }))}
          initial={9}
          shuffleable
        />
      </div>

      <div className="mt-10 border-t border-[var(--line)] pt-8 sm:mt-12 sm:pt-10">{rankings}</div>
    </div>
  );
}

/** Featured — artwork floating over a colour field which is that same artwork blurred, so
 * a card is tinted by what it holds without a palette being sampled. */
function Featured({ data }: { data: Discover }) {
  const cards: {
    key: string;
    eyebrow: string;
    title: string;
    subtitle?: string;
    href: string;
    image: string | null;
    covers?: string[];
  }[] = [];

  if (data.tracks.length > 0) {
    cards.push({
      key: "chart",
      eyebrow: "Chart · this week",
      title: "Top songs this week",
      subtitle: `${data.tracks.length} songs · Deezer`,
      href: "/collection/genre/0",
      image: null,
      covers: data.tracks
        .map((track) => track.artworkUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, 5),
    });
  }

  for (const playlist of data.playlists.slice(0, 5)) {
    cards.push({
      key: `playlist-${playlist.id}`,
      eyebrow: "Playlist",
      title: playlist.title,
      subtitle: [playlist.trackCount ? `${playlist.trackCount} songs` : null, playlist.by]
        .filter(Boolean)
        .join(" · "),
      href: `/collection/playlist/${playlist.id}`,
      image: playlist.covers.length >= 3 ? null : playlist.coverUrl,
      covers: playlist.covers,
    });
  }

  for (const album of data.albums.slice(0, 8)) {
    cards.push({
      key: `album-${album.id}`,
      eyebrow: album.kind === "single" ? "Single" : album.kind === "ep" ? "EP" : "Album",
      title: album.title,
      subtitle: album.artist,
      href: `/album/${album.id}`,
      image: album.coverUrl,
    });
  }

  // Deezer publishes no charting playlists for some genres, so a short row is padded.
  if (cards.length < 4) {
    for (const genre of data.genres.filter((entry) => entry.id !== 0).slice(0, 5)) {
      cards.push({
        key: `genre-${genre.id}`,
        eyebrow: "Genre",
        title: `${genre.name} right now`,
        subtitle: "Deezer chart",
        href: `/collection/genre/${genre.id}`,
        image: genre.imageUrl,
      });
    }
  }

  if (cards.length === 0) return null;

  return (
    <Shelf title="Featured">
      {cards.map((card) => {
        const backdrop = card.image ?? card.covers?.[0] ?? null;

        return (
          <Link key={card.key} href={card.href} className="group w-[15rem] shrink-0 sm:w-[20rem]">
            {/* 4:3 — at 16:10 the cover shrank to fit and the card became mostly background. */}
            <div className="press relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)]">
              {backdrop && (
                <>
                  {/* Scaled past the frame so the blur has no edge to feather against — one
                      that can see the border shows as a pale halo in the corners. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs */}
                  <img
                    // 120px is generous behind a blur-3xl: it discards finer detail anyway.
                    src={coverSrc(backdrop, 120) ?? undefined}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full scale-[2] object-cover opacity-70 blur-3xl saturate-150"
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-b from-white/5 to-black/25"
                  />
                </>
              )}

              {card.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                <img
                  // 76% of a card that tops out around 300px, so 500 device pixels.
                  src={coverSrc(card.image, 500) ?? undefined}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute left-1/2 top-1/2 aspect-square h-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[4px] object-cover shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
                />
              ) : (
                /* Positioned by this wrapper, not a class on <Collage>: its root is `relative`
                   and Tailwind emits `.relative` after `.absolute`, so a passed-in
                   `absolute inset-0` lost the cascade and the card collapsed to its backdrop. */
                <div className="absolute inset-0">
                  <Collage covers={card.covers ?? []} className="size-full" rounded="" />
                </div>
              )}
            </div>

            <p className="mt-2.5 truncate text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              {card.eyebrow}
            </p>
            <p className="line-clamp-2 text-[13px] font-bold leading-snug group-hover:underline sm:text-[15px]">
              {card.title}
            </p>
            {card.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-[var(--fg-dim)] sm:text-[12px]">
                {card.subtitle}
              </p>
            )}
          </Link>
        );
      })}
    </Shelf>
  );
}

/** A titled row of pills. "View all" opens the rest in place — there is no index page. */
function PillSection({
  title,
  pills,
  initial,
  shuffleable = false,
}: {
  title: string;
  pills: { key: string; label: string; href: string }[];
  initial: number;
  /** Adds the dice. Only worth it where the list is long enough to surprise. */
  shuffleable?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  if (pills.length === 0) return null;

  const visible = expanded ? pills : pills.slice(0, initial);

  return (
    <section className="mb-6 sm:mb-8">
      <div className="mb-2.5 flex items-center justify-between gap-4 px-1 sm:mb-3.5">
        <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{title}</h2>

        <div className="flex shrink-0 items-center gap-2">
          {shuffleable && (
            <button
              type="button"
              onClick={() => {
                // Drawn in a handler, never during render: a random value taken while
                // rendering differs between React's two passes and between server and browser.
                const pick = pills[Math.floor(Math.random() * pills.length)];
                if (pick) router.push(pick.href);
              }}
              aria-label={`Open a random ${title.toLowerCase()} collection`}
              title="Surprise me"
              className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg-dim)] transition hover:text-[var(--fg)]"
            >
              <ShuffleIcon className="size-4" />
            </button>
          )}

          {pills.length > initial && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="press text-[12px] font-semibold text-[var(--fg-dim)] hover:text-[var(--fg)]"
            >
              {expanded ? "Show less" : "View all"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-1 sm:gap-2">
        {visible.map((pill) => (
          <Link
            key={pill.key}
            href={pill.href}
            className="slab-sm press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] sm:px-4 sm:py-2.5 sm:text-[13px]"
          >
            {pill.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Stations round-robin, one genre at a time — Deezer returns them grouped, so the
 * first nine in order are all Pop. */
function interleave(radios: Radio[]): Radio[] {
  const byGenre = new Map<string, Radio[]>();
  for (const radio of radios) {
    const existing = byGenre.get(radio.genre);
    if (existing) existing.push(radio);
    else byGenre.set(radio.genre, [radio]);
  }

  const queues = [...byGenre.values()];
  const out: Radio[] = [];
  // Capped: the full list runs past a hundred, and "View all" should open a choice.
  for (let round = 0; out.length < 36; round += 1) {
    const before = out.length;
    for (const queue of queues) {
      const radio = queue[round];
      if (radio) out.push(radio);
    }
    if (out.length === before) break;
  }

  return out.slice(0, 36);
}
