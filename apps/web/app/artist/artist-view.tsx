"use client";

import { useMemo, useState, type ReactNode } from "react";

import type { Release, RelatedArtist } from "@/lib/discography";

import { PlayRow } from "../album/album-view";
import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";
import { Artwork } from "../artwork";
import { sized } from "../artwork-url";
import { ExternalIcon } from "../icons";
import { Caption, EmptyNotice, Page, PageHeader } from "../page-chrome";
import { usePlayerControls } from "../player/player-context";
import { Shelf } from "../shelf";
import { TILE } from "../song-card";
import { SongActions, SongRow } from "../song-row";
import { ROW_BADGES, SourceBadges } from "../source-badges";
import { sourceStyle } from "../sources";
import { ArtistCard, ReleaseCard } from "../tile-cards";
import type { Song } from "../types";
import { albumAddsSomething } from "./song-subtitle";

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
  about,
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
  about?: ReactNode;
}) {
  const { play, current, state } = usePlayerControls();
  const [showAll, setShowAll] = useState(false);

  const queueable = useMemo<Song[]>(() => {
    const from = { kind: "artist" as const, name, imageUrl };
    return songs.map((song) => ({ ...song, from }));
  }, [songs, name, imageUrl]);
  const visible = showAll ? queueable : queueable.slice(0, SONG_LIMIT);
  const source = sourceName && sourceStyle(sourceName).label;

  return (
    <Page>
      <PageHeader
        art={
          <Artwork
            src={sized(imageUrl, 640)}
            className="slab size-24 shrink-0 rounded-[var(--r-full)] sm:size-40"
            iconClassName="size-10"
            eager
          />
        }
        eyebrow="Artist"
        title={name}
      >
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--fg-faint)]">
          {followers !== null && source && (
            <span>{followers.toLocaleString()} followers on {source}</span>
          )}
          <span>
            {songs.length} {songs.length === 1 ? "song" : "songs"} Timbre can reach
          </span>
        </div>
        <PlayRow songs={queueable}>
          {sourceUrl && source && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="slab-sm press inline-flex items-center gap-1.5 rounded-[var(--r-full)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-semibold"
            >
              Open on {source}
              <ExternalIcon className="size-3" />
            </a>
          )}
        </PlayRow>
      </PageHeader>

      {songs.length === 0 ? (
        <EmptyNotice>
          Nothing found for {name}. Try searching instead — the spelling may differ from the one
          Timbre was given.
        </EmptyNotice>
      ) : (
        <>
          <h2 className="mb-3 text-xl font-extrabold tracking-tight">Songs</h2>
          {!filtered && (
            <Caption className="mb-3">
              No result credits {name} directly, so these are search matches for the name.
            </Caption>
          )}

          <ul className="divide-y divide-[var(--line)]">
            {visible.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                onPlay={() => play(song, queueable)}
                isCurrent={current?.id === song.id}
                isPlaying={state === "playing"}
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
                    <SongActions song={song} />
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
              <ArtistCard href={`/artist/${toArtistSlug(artist.name)}`} name={artist.name} imageUrl={artist.imageUrl} />
            </div>
          ))}
        </Shelf>
      )}

      {about}
    </Page>
  );
}
