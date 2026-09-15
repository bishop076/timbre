"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { toArtistSlug } from "../artist-slug";
import { Artwork } from "../artwork";

interface Artist {
  name: string;
  imageUrl: string | null;
  followers: number | null;
}

interface Release {
  id: number;
  title: string;
  kind: string;
  year: string | null;
  coverUrl: string | null;
}

export interface ArtistMatch {
  artist: Artist;
  albums: Release[];
}

interface ArtistResponse {
  artist?: Artist | null;
  releases?: Release[];
}

const ALBUMS_SHOWN = 12;

function followerCount(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (total >= 1_000) return `${Math.round(total / 1_000)}K`;
  return String(total);
}

/**
 * The songs endpoint only ever returns tracks, so an "Artists" or "Albums" heading has to come
 * from somewhere else: /api/artist, the same lookup the artist pages run, which carries the
 * artist's own picture and their discography.
 *
 * Deezer's artist search is a loose one and will answer almost anything — "lofi study mix" comes
 * back as "Lofi Study Man", two followers — so only an exact name match earns a section. The
 * comparison is `toArtistSlug` on both sides, which is the normalisation the artist route already
 * uses, so anything shown here is guaranteed to have a page behind it.
 */
export function useArtistMatch(query: string): ArtistMatch | null {
  const [found, setFound] = useState<{ key: string; match: ArtistMatch | null } | null>(null);

  const trimmed = query.trim();
  const searchable = trimmed.length > 1 && !/^https?:\/\//i.test(trimmed);

  useEffect(() => {
    if (!searchable) return;

    const aborter = new AbortController();

    // Same 300ms as the song search, so the two requests leave together rather than the artist
    // lookup firing on every keystroke behind it.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/artist?name=${encodeURIComponent(trimmed)}&full=1`, {
            signal: aborter.signal,
          });
          const body = response.ok ? ((await response.json()) as ArtistResponse | null) : null;
          const artist = body?.artist ?? null;
          const exact = artist && toArtistSlug(artist.name) === toArtistSlug(trimmed);

          setFound({
            key: trimmed,
            match: exact
              ? {
                  artist,
                  albums: (body?.releases ?? [])
                    .filter((release) => release.kind === "album")
                    .slice(0, ALBUMS_SHOWN),
                }
              : null,
          });
        } catch {
          // A missing artist panel is not worth a message. The songs below are the answer.
          if (!aborter.signal.aborted) setFound({ key: trimmed, match: null });
        }
      })();
    }, 300);

    return () => {
      clearTimeout(timer);
      aborter.abort();
    };
  }, [searchable, trimmed]);

  if (!searchable) return null;
  return found?.key === trimmed ? found.match : null;
}

/** One line, the height of a song row, so the artist reads as another result and not a banner. */
export function ArtistResult({ artist }: { artist: Artist }) {
  return (
    <Link
      href={`/artist/${toArtistSlug(artist.name)}`}
      className="group flex items-center gap-3 rounded-[var(--r-md)] px-2 py-2 transition hover:bg-[var(--surface-2)] sm:gap-4"
    >
      <Artwork
        src={artist.imageUrl}
        className="slab-sm size-12 shrink-0 rounded-[var(--r-full)]"
        iconClassName="size-5"
        surfaceClassName="bg-[var(--surface-2)]"
      />
      <span className="min-w-0">
        <span className="block truncate text-[length:var(--text-body)] font-bold tracking-[var(--track-body)]">
          {artist.name}
        </span>
        <span className="mt-0.5 block truncate text-[length:var(--text-meta)] text-[var(--fg-faint)]">
          Artist
          {artist.followers ? ` · ${followerCount(artist.followers)} followers` : ""}
        </span>
      </span>
    </Link>
  );
}

export function AlbumResults({ albums }: { albums: Release[] }) {
  return (
    <ul className="shelf flex gap-3 overflow-x-auto px-1 pb-1 sm:gap-4">
      {albums.map((album) => (
        <li key={album.id} className="w-[100px] shrink-0 sm:w-[116px]">
          <Link href={`/album/${album.id}`} className="group block">
            <Artwork
              src={album.coverUrl}
              className="press aspect-square w-full rounded-[var(--r-md)] transition duration-500 ease-[var(--ease)] group-hover:brightness-110"
              iconClassName="size-6"
            />
            <span className="mt-2 block truncate text-[length:var(--text-meta)] font-bold">
              {album.title}
            </span>
            <span className="mt-0.5 block truncate text-[length:var(--text-meta)] text-[var(--fg-faint)]">
              {album.year ?? "Album"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
