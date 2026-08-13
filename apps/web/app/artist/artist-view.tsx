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
import { sourceStyle } from "../sources";
import type { Song } from "../types";
import type { Release, RelatedArtist } from "@/lib/discography";
import { cover as coverSrc } from "../artwork-url";

/**
 * The artist page's surface.
 *
 * Songs are a plain ranked list rather than shelves of albums, because the
 * sources Timbre can reach do not agree on album membership — YouTube Music
 * often has no album at all for an upload, and stitching one together from
 * three partial answers would invent a discography rather than show one.
 *
 * Playing any row queues the rest of the list behind it, so the page behaves
 * like a playlist without pretending to be one.
 */

/** Reading order for a discography, and what Deezer's tags map onto. */
/** One tile's width, shared by every shelf on the page. */
const TILE = "w-[7rem] shrink-0 snap-start sm:w-[10.5rem]";

/** Songs shown before the reader asks for the rest. */
const SONG_LIMIT = 10;

const GROUPS: { heading: string; kinds: readonly string[] }[] = [
  { heading: "Albums", kinds: ["album", "compile"] },
  { heading: "EPs", kinds: ["ep"] },
  { heading: "Singles", kinds: ["single"] },
];

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

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

  /*
   * Ten songs, then a button.
   *
   * The search behind this returns forty, and forty rows pushed the
   * discography so far down the page that most people never saw it. Ten is
   * about a screen — enough to recognise an artist by, short enough that what
   * comes after it is still on the way.
   */
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
            // Honest caveat rather than a silently looser list: the filter found
            // nothing, so these are search results for the name, not a verified
            // discography.
            <p className="mb-3 text-xs leading-relaxed text-[var(--fg-faint)]">
              No result credits {name} directly, so these are search matches for the name.
            </p>
          )}

          <ul className="divide-y divide-[var(--line)]">
            {visible.map((song) => {
              const isCurrent = current?.id === song.id;
              return (
                <li
                  key={song.id}
                  className={`group flex items-center gap-3 rounded-lg px-2 transition sm:gap-4 ${
                    isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => play(song, songs)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left focus:outline-none sm:gap-4 sm:py-3"
                    aria-label={`Play ${song.title}`}
                  >
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-[var(--surface-1)] sm:size-12">
                      {song.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                        <img
                          src={coverSrc(song.artworkUrl, 112) ?? undefined}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[var(--fg-dim)]">
                          <NoteIcon className="size-5" />
                        </span>
                      )}
                      <span
                        className={`absolute inset-0 flex items-center justify-center bg-black/55 transition ${
                          isCurrent && state === "playing"
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        }`}
                      >
                        <PlayIcon className="size-4 text-white" />
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[15px] font-medium ${
                          isCurrent ? "text-[var(--accent)]" : ""
                        }`}
                      >
                        {song.title}
                      </span>
                      <span className="block truncate text-sm text-[var(--fg-dim)]">
                        {song.album ?? song.artists.join(", ")}
                      </span>
                    </span>
                  </button>

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
                </li>
              );
            })}
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

      {/* ---------------------------------------------------------------- */}
      {/* Discography                                                       */}
      {/* ---------------------------------------------------------------- */}
      {/*
        Grouped by what Deezer calls the record, in the order a discography is
        usually read: albums, then EPs, then singles. Compilations are left in
        with the albums rather than given a heading of their own — one row
        labelled "Compilation" on most artists is a heading that earns nothing.
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

      {/* ---------------------------------------------------------------- */}
      {/* Neighbours                                                        */}
      {/* ---------------------------------------------------------------- */}
      {related.length > 0 && (
        <Shelf title="Similar artists">
          {related.map((artist) => (
            <div key={artist.name} className="w-28 shrink-0 snap-start">
              {/* Keyed by name like every other artist link here — Timbre's
                  artist route belongs to no single service, so it cannot take
                  Deezer's id even though that is what found this row. */}
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
