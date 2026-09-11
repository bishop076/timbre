"use client";

import { useMemo, useState } from "react";

import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";

import { Shelf } from "../shelf";
import { ExternalIcon, NoteIcon, PlayIcon } from "../icons";
import { AddToQueue } from "../player/add-to-queue";
import { usePlayerControls } from "../player/player-context";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { TILE } from "../song-card";
import { SongRow } from "../song-row";
import { ROW_BADGES, SourceBadges } from "../source-badges";
import { ArtistCard, ReleaseCard } from "../tile-cards";
import { sourceStyle } from "../sources";
import { albumAddsSomething } from "./song-subtitle";
import type { Song } from "../types";
import type { Release, RelatedArtist } from "@/lib/discography";
import { cover as coverSrc } from "../artwork-url";
import { formatDuration } from "../duration";

// The artist page's surface. Songs are a plain ranked list rather than shelves of albums,
// because Timbre's sources do not agree on album membership — YouTube Music often has none
// at all. Playing any row queues the rest behind it.

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
  const { play, current, state } = usePlayerControls();

  // Every song queued from this page says so, which is what lets "Recently played" show this
  // artist once instead of a run of their songs. Tagged here, the one page that knows.
  const queueable = useMemo<Song[]>(() => {
    const from = { kind: "artist" as const, name, imageUrl };
    return songs.map((song) => ({ ...song, from }));
  }, [songs, name, imageUrl]);

  // Ten, then a button: forty rows pushed the discography below where anyone looked.
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? queueable : queueable.slice(0, SONG_LIMIT);

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
                onClick={() => play(queueable[0]!, queueable)}
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
                onPlay={() => play(song, queueable)}
                isCurrent={current?.id === song.id}
                isPlaying={state === "playing"}
                // The album only when it is not the title again — see `albumAddsSomething`.
                // Otherwise the credits, which is what every other song list in Timbre shows
                // and which surfaces the guests a collaboration is billed to.
                subtitle={
                  albumAddsSomething(song.album, song.title) ? (
                    song.album
                  ) : (
                    <ArtistLink artists={song.artists} />
                  )
                }
                trailing={
                  <>
                    <SourceBadges song={song} className={ROW_BADGES} />

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
                <ReleaseCard
                  href={`/album/${release.id}`}
                  coverUrl={release.coverUrl}
                  title={release.title}
                  subtitle={[release.year, release.trackCount ? `${release.trackCount} tracks` : null]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </div>
            ))}
          </Shelf>
        );
      })}

      {related.length > 0 && (
        <Shelf title="Similar artists">
          {related.map((artist) => (
            <div key={artist.name} className={TILE}>
              {/* Keyed by name: Timbre's artist route belongs to no single service. */}
              <ArtistCard href={`/artist/${toArtistSlug(artist.name)}`} name={artist.name} imageUrl={artist.imageUrl} />
            </div>
          ))}
        </Shelf>
      )}
    </div>
  );
}
