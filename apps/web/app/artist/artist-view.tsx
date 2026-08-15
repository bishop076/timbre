"use client";

import { useState } from "react";

import { toArtistSlug } from "../artist-slug";
import Link from "next/link";

import { Artwork } from "../artwork";
import { Shelf } from "../shelf";
import { ExternalIcon, NoteIcon, PlayIcon } from "../icons";
import { AddToQueue } from "../player/add-to-queue";
import { usePlayer } from "../player/player-context";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { SongRow } from "../song-row";
import { sourceStyle } from "../sources";
import type { Song } from "../types";
import type { Release, RelatedArtist } from "@/lib/discography";
import { cover as coverSrc } from "../artwork-url";
import { formatDuration } from "../duration";

// The artist page's surface. Songs are a plain ranked list rather than shelves of albums,
// because Timbre's sources do not agree on album membership — YouTube Music often has none
// at all. Playing any row queues the rest behind it.

/** One tile's width, shared by every shelf on the page. */
const TILE = "w-[7rem] shrink-0 snap-start sm:w-[10.5rem]";

/** Songs shown before the reader asks for the rest. */
const SONG_LIMIT = 10;

const GROUPS: { heading: string; kinds: readonly string[] }[] = [
  { heading: "Albums", kinds: ["album", "compile"] },
  { heading: "EPs", kinds: ["ep"] },
  { heading: "Singles", kinds: ["single"] },
];


export function ArtistView({
  name,
  imageUrl,
  followers,
  sourceUrl,
  sourceName,
  songs,
  filtered,
  releases,
  related,
}: {
  name: string;
  imageUrl: string | null;
  followers: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  songs: Song[];
  filtered: boolean;
  releases: Release[];
  related: RelatedArtist[];
}) {
  const { play, current, state } = usePlayer();

  // Ten, then a button: forty rows pushed the discography below where anyone looked.
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? songs : songs.slice(0, SONG_LIMIT);

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
        <div className="slab size-24 shrink-0 overflow-hidden rounded-[var(--r-full)] bg-[var(--surface-2)] sm:size-40">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
            <img src={coverSrc(imageUrl, 640) ?? undefined} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[var(--fg-faint)]">
              <NoteIcon className="size-10" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            Artist
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">{name}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--fg-faint)]">
            {followers !== null && sourceName && (
              <span>
                {followers.toLocaleString()} followers on {sourceStyle(sourceName).label}
              </span>
            )}
            <span>
              {songs.length} {songs.length === 1 ? "song" : "songs"} Timbre can reach
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {songs.length > 0 && (
              <button
                type="button"
                onClick={() => play(songs[0]!, songs)}
                className="slab-sm press inline-flex items-center gap-2 rounded-[var(--r-full)] px-5 py-2.5 text-sm font-bold text-[var(--accent-fg)]"
                style={{ background: "var(--accent)" }}
              >
                <PlayIcon className="size-4" />
                Play
              </button>
            )}
            {sourceUrl && sourceName && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="slab-sm press inline-flex items-center gap-1.5 rounded-[var(--r-full)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-semibold"
              >
                Open on {sourceStyle(sourceName).label}
                <ExternalIcon className="size-3" />
              </a>
            )}
          </div>
        </div>
      </header>

      {songs.length === 0 ? (
        <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          Nothing found for {name}. Try searching instead — the spelling may differ from the one
          Timbre was given.
        </p>
      ) : (
        <>
          <h2 className="mb-3 text-xl font-extrabold tracking-tight">Songs</h2>
          {!filtered && (
            // The filter found nothing, so these are search results for the name rather
            // than a verified discography — said plainly, not silently.
            <p className="mb-3 text-xs leading-relaxed text-[var(--fg-faint)]">
              No result credits {name} directly, so these are search matches for the name.
            </p>
          )}

          <ul className="divide-y divide-[var(--line)]">
            {visible.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                onPlay={() => play(song, songs)}
                isCurrent={current?.id === song.id}
                isPlaying={state === "playing"}
                subtitle={song.album ?? song.artists.join(", ")}
                trailing={
                  <>
                    <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
                      {formatDuration(song.durationMs)}
                    </span>

                    <AddToQueue
                      song={song}
                      className="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
                    />

                    <AddToPlaylist
                      song={song}
                      className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                    />
                  </>
                }
              />
            ))}
          </ul>

          {!showAll && songs.length > SONG_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="slab-sm press mt-4 w-full rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-2.5 text-[13px] font-bold text-[var(--fg-dim)] hover:text-[var(--fg)]"
            >
              Show all {songs.length} songs
            </button>
          )}
        </>
      )}

      {/*
        Discography, grouped by Deezer's record type in reading order. Compilations
        stay with the albums — one row labelled "Compilation" earns no heading.
      */}
      {GROUPS.map(({ heading, kinds }) => {
        const group = releases.filter((release) => kinds.includes(release.kind));
        if (group.length === 0) return null;
        return (
          <Shelf
            key={heading}
            title={heading}
            caption={`${group.length} ${group.length === 1 ? "release" : "releases"}`}
          >
            {group.map((release) => (
              <div key={release.id} className={TILE}>
                <Link
                  href={`/album/${release.id}`}
                  className="block snap-start rounded-[var(--r-lg)] p-2 transition hover:bg-[var(--surface-2)]"
                >
                  <Artwork
                    src={release.coverUrl}
                    className="slab aspect-square w-full rounded-[var(--r-md)]"
                    iconClassName="size-7"
                  />
                  <span className="mt-2.5 block truncate text-[13px] font-semibold">
                    {release.title}
                  </span>
                  <span className="block truncate text-xs text-[var(--fg-dim)]">
                    {[release.year, release.trackCount ? `${release.trackCount} tracks` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </div>
            ))}
          </Shelf>
        );
      })}

      {related.length > 0 && (
        <Shelf title="Similar artists">
          {related.map((artist) => (
            <div key={artist.name} className="w-28 shrink-0 snap-start">
              {/* Keyed by name: Timbre's artist route belongs to no single service. */}
              <Link
                href={`/artist/${toArtistSlug(artist.name)}`}
                className="block rounded-[var(--r-lg)] p-2 text-center transition hover:bg-[var(--surface-2)]"
              >
                <Artwork
                  src={artist.imageUrl}
                  className="slab aspect-square w-full rounded-[var(--r-full)]"
                  iconClassName="size-6"
                />
                <span className="mt-2 block truncate text-[13px] font-semibold">{artist.name}</span>
              </Link>
            </div>
          ))}
        </Shelf>
      )}
    </div>
  );
}
