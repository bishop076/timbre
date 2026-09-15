"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { hideWhenBroken } from "./artwork";
import { cover as coverSrc } from "./artwork-url";
import { Collage } from "./collage";
import { ExploreForYou, kindLabel } from "./explore-for-you";
import { ShuffleIcon } from "./icons";
import { SectionHeader } from "./page-chrome";
import { Shelf } from "./shelf";
import { COVER_EMPTY, TILE_BOX } from "./song-card";
import { useTaste } from "./taste-store";
import type { Discover } from "@/lib/discover";
import type { Radio } from "@/lib/radios";
import { interleaveBy, seededShuffle } from "@/lib/rotation";

export function DiscoverView({
  initial,
  radios,
  rotation,
  rankings,
}: {
  initial: Discover;
  radios: Radio[];
  rotation: number;
  rankings: ReactNode;
}) {
  const taste = useTaste();
  const yours = taste.genres.map((genre) => genre.id);

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      <h1 className="mb-4 px-1 text-xl font-extrabold tracking-tight sm:mb-6 sm:text-2xl">Explore</h1>

      {/* No reserved height here. `100dvh - 9rem` was a guess at the chrome above and below,
          and on a short window it reserved most of the screen for content that already fills
          it — the For-you shelves render skeletons at their final height while they load, so
          nothing below them moves. */}
      <ExploreForYou genres={initial.genres} />

      <Featured data={initial} />

      <PillSection
        title="Genres"
        pills={yoursFirst(
          initial.genres.filter((entry) => entry.id !== 0),
          (entry) => entry.id,
          yours,
        ).map((entry) => ({
          label: entry.name,
          href: `/collection/genre/${entry.id}`,
          yours: yours.includes(entry.id),
        }))}
      />

      <PillSection
        title="Stations"
        pills={interleave(radios, rotation, yours).map((radio) => ({
          label: radio.title,
          href: `/collection/radio/${radio.id}`,
          yours: yours.includes(radio.genreId),
        }))}
      />

      <div className="mt-10 border-t border-[var(--line)] pt-8 sm:mt-12 sm:pt-10">{rankings}</div>
    </div>
  );
}

/** Featured cards are wide, so only the first couple are ever on screen without scrolling. */
const EAGER_FEATURED = 2;

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
      covers: data.tracks.flatMap((track) => track.artworkUrl || []).slice(0, 5),
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
    const kind = kindLabel(album.kind);
    cards.push({
      key: `album-${album.id}`,
      eyebrow: album.fresh ? `New ${kind.toLowerCase()} · editors' pick` : kind,
      title: album.title,
      subtitle: album.artist,
      href: `/album/${album.id}`,
      image: album.coverUrl,
    });
  }

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
      {cards.map((card, index) => {
        const backdrop = card.image ?? card.covers?.[0] ?? null;
        // The first two are on screen at any width a Featured shelf is shown at, and a cover
        // that waits for the scroller before it starts loading is a card that arrives empty.
        const eager = index < EAGER_FEATURED;

        return (
          <Link
            key={card.key}
            href={card.href}
            // A rem wider than it was on each step, because `TILE_BOX` adds the same 2 of
            // padding a song tile has: the picture inside is the size it always was, and the
            // card now lights up on hover as one panel the way the rest of the shelf does.
            className={`group w-[16rem] shrink-0 @xl:w-[21rem] ${TILE_BOX}`}
          >
            <div
              className={`slab-sm press relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-md)] ${COVER_EMPTY}`}
            >
              {backdrop && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={coverSrc(backdrop, 120) ?? undefined}
                    alt=""
                    aria-hidden
                    loading={eager ? "eager" : "lazy"}
                    decoding={eager ? "sync" : "async"}
                    {...hideWhenBroken}
                    className="absolute inset-0 size-full scale-[2] object-cover opacity-70 blur-3xl saturate-150"
                  />
                  {/* Settles the blur into the page rather than dimming it. This was
                      `from-white/5 to-black/25` — a black wash that only ever suited the dark
                      theme, and in the light one laid a grey shadow across a blush page. Fading
                      to `--bg` does the same job of keeping the floating cover legible and is
                      the right colour in both. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg)] opacity-80"
                  />
                </>
              )}

              {card.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverSrc(card.image, 500) ?? undefined}
                  alt=""
                  loading={eager ? "eager" : "lazy"}
                  decoding={eager ? "sync" : "async"}
                  {...hideWhenBroken}
                  className="absolute left-1/2 top-1/2 aspect-square h-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[var(--r-sm)] object-cover shadow-[var(--drop-lg)]"
                />
              ) : (
                // `Collage` falls back to a flat `--surface-2` panel with a grey note when every
                // cover in it is dead — the exact box this card is trying not to be, and it
                // lives in a file this change does not own. Two overrides reach into it from
                // out here: its own background is a *colour* and `COVER_EMPTY` is an *image*,
                // so the lit ground paints over it whichever branch it takes; and a rule on the
                // glyph itself beats the inherited `--fg-faint`, so the note matches the one on
                // every other empty cover instead of going grey.
                <div className="absolute inset-0 [&_svg]:text-[var(--accent-text)] [&_svg]:opacity-60">
                  <Collage
                    covers={card.covers ?? []}
                    className={`size-full ${COVER_EMPTY}`}
                    rounded=""
                  />
                </div>
              )}
            </div>

            {/* `--accent` is a surface colour carrying black text, never a text colour itself:
                as an eyebrow on a blush page it was pink on near-pink. `--accent-text` is the
                readable one, and it is the accent in both themes. */}
            <p className="mt-2 truncate text-[10px] font-bold uppercase tracking-wider text-[var(--accent-text)]">
              {card.eyebrow}
            </p>
            <p
              title={card.title}
              className="line-clamp-2 text-[13px] font-bold leading-snug group-hover:underline @xl:text-[15px]"
            >
              {card.title}
            </p>
            {card.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-[var(--fg-dim)] @xl:text-[12px]">
                {card.subtitle}
              </p>
            )}
          </Link>
        );
      })}
    </Shelf>
  );
}

const INITIAL_PILLS = 9;

function PillSection({
  title,
  pills,
}: {
  title: string;
  pills: { label: string; href: string; yours: boolean }[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  if (pills.length === 0) return null;

  const visible = expanded ? pills : pills.slice(0, INITIAL_PILLS);

  return (
    <section className="mb-6 sm:mb-8">
      <SectionHeader title={title}>
        <button
          type="button"
          onClick={() => {
            const pick = pills[Math.floor(Math.random() * pills.length)];
            if (pick) router.push(pick.href);
          }}
          aria-label={`Open a random ${title.toLowerCase()} collection`}
          title="Surprise me"
          className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg-dim)] transition hover:text-[var(--fg)]"
        >
          <ShuffleIcon className="size-4" />
        </button>

        {pills.length > INITIAL_PILLS && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="press text-[12px] font-semibold text-[var(--fg-dim)] hover:text-[var(--fg)]"
          >
            {expanded ? "Show less" : "View all"}
          </button>
        )}
      </SectionHeader>

      <div className="flex flex-wrap gap-1.5 px-1 sm:gap-2">
        {visible.map((pill) => (
          <Link
            key={pill.href}
            href={pill.href}
            title={pill.yours ? "In a genre you play" : undefined}
            className={`slab-sm press flex items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-semibold transition hover:text-[var(--fg)] sm:px-4 sm:py-2.5 sm:text-[13px] ${
              pill.yours ? "text-[var(--fg)]" : "text-[var(--fg-dim)]"
            }`}
          >
            {pill.yours && (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
            )}
            {pill.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function yoursFirst<T>(items: T[], genreOf: (item: T) => number, yours: number[]): T[] {
  const rank = (item: T) => {
    const index = yours.indexOf(genreOf(item));
    return index === -1 ? yours.length : index;
  };
  return items.slice().sort((a, b) => rank(a) - rank(b));
}

const LEAD_STATIONS = 3;

function interleave(radios: Radio[], rotation: number, yours: number[]): Radio[] {
  const genres = [...new Set(radios.map((radio) => radio.genreId))];
  const queues = new Map<number, Radio[]>(
    genres.map((genre) => [
      genre,
      seededShuffle(radios.filter((radio) => radio.genreId === genre), rotation * 13 + genre),
    ]),
  );

  const lead = yours
    .slice(0, 2)
    .flatMap((genre) => queues.get(genre)?.splice(0, LEAD_STATIONS) ?? []);
  const order = yoursFirst(seededShuffle(genres, rotation), (genre) => genre, yours);
  const rest = order.map((genre) => queues.get(genre)!);
  return [...lead, ...interleaveBy(rest, (radio) => String(radio.id), 36 - lead.length)];
}
