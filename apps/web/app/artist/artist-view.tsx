"use client";

import { useMemo, useState, type ReactNode } from "react";

import type { Release, RelatedArtist } from "@/lib/discography";

import {
  DETAIL_SECONDARY,
  DetailHeader,
  Dot,
  PlayRow,
  TrackRank,
} from "../album/detail-chrome";
import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";
import { Artwork } from "../artwork";
import { sized } from "../artwork-url";
import { ExternalIcon } from "../icons";
import { Caption, EmptyNotice, Page } from "../page-chrome";
import { useJson } from "../player/panel-tabs";
import { usePlayerControls } from "../player/player-context";
import { RowSkeletons } from "../row-skeleton";
import { Shelf } from "../shelf";
import { TILE } from "../song-card";
import { SongActions, SongRow } from "../song-row";
import { ROW_BADGES, SourceBadges } from "../source-badges";
import { sourceStyle } from "../sources";
import { ArtistCard, ReleaseCard } from "../tile-cards";
import type { Song, SongsResponse } from "../types";
import { creditNames } from "./credits";
import { albumAddsSomething } from "./song-subtitle";

const SONG_LIMIT = 10;
const RELEASE_LIMIT = 12;

const GROUPS: { id: string; label: string; kinds: readonly string[] }[] = [
  { id: "album", label: "Albums", kinds: ["album", "compile"] },
  { id: "ep", label: "EPs", kinds: ["ep"] },
  { id: "single", label: "Singles", kinds: ["single"] },
];

const KIND_LABELS: Record<string, string> = {
  album: "Album",
  compile: "Compilation",
  ep: "EP",
  single: "Single",
};

/**
 * The artist's picture, at `DETAIL_ART`'s size and edge but round. An artist is a face, not a
 * sleeve — every reference draws that one circular, and it is the only thing on a detail header
 * that differs between an album and a person.
 */
const ARTIST_ART = "slab size-28 shrink-0 rounded-[var(--r-full)] @lg:size-40";

// Both states carry the same ink edge, so switching filters cannot shift the row by 2 × --edge.
const CHIP =
  "press inline-flex h-8 shrink-0 items-center rounded-[var(--r-full)] px-3.5 text-[length:var(--text-meta)] font-semibold transition";
const CHIP_OFF = `${CHIP} slab-sm bg-[var(--surface-1)] text-[var(--fg-dim)] hover:text-[var(--fg)]`;
const CHIP_ON = `${CHIP} slab-sm text-[var(--accent-fg)]`;

/** A section head at the ramp's title size. The page's own, so every heading on it matches. */
function SectionRow({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-1">
      <h2 className="text-[length:var(--text-title)] font-extrabold tracking-[var(--track-title)]">
        {title}
      </h2>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div>}
    </div>
  );
}

function Discography({ releases }: { releases: Release[] }) {
  const [filter, setFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(
    () => GROUPS.filter((group) => releases.some((release) => group.kinds.includes(release.kind))),
    [releases],
  );
  const shown = useMemo(() => {
    const picked = groups.find((group) => group.id === filter);
    return picked ? releases.filter((release) => picked.kinds.includes(release.kind)) : releases;
  }, [releases, groups, filter]);

  const visible = showAll ? shown : shown.slice(0, RELEASE_LIMIT);

  return (
    <section className="mb-7 sm:mb-9">
      <SectionRow title="Discography">
        {groups.length > 1 &&
          [{ id: "all", label: "All" }, ...groups].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={filter === id ? CHIP_ON : CHIP_OFF}
              style={filter === id ? { background: "var(--accent)" } : undefined}
            >
              {label}
            </button>
          ))}
      </SectionRow>

      {/* A grid rather than a shelf: a discography is the one list on this page a reader scans
          for a title they already have in mind, and a row that scrolls sideways hides most of it
          behind a gesture. The tile is the same width the shelves use, so nothing was resized. */}
      <ul className="grid grid-cols-2 gap-x-1 gap-y-1 @sm:grid-cols-3 @xl:grid-cols-4 @3xl:grid-cols-5 @5xl:grid-cols-6">
        {visible.map((release) => (
          <li key={release.id}>
            <ReleaseCard
              href={`/album/${release.id}`}
              coverUrl={release.coverUrl}
              title={release.title}
              subtitle={[release.year, KIND_LABELS[release.kind]].filter(Boolean).join(" · ")}
            />
          </li>
        ))}
      </ul>

      {shown.length > RELEASE_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className={`${DETAIL_SECONDARY} mx-1 mt-3`}
        >
          {showAll ? "Show fewer" : `Show all ${shown.length} releases`}
        </button>
      )}
    </section>
  );
}

export function ArtistView({
  query,
  name,
  imageUrl,
  followers,
  sourceUrl,
  sourceName,
  releases,
  related,
  about,
}: {
  query: string;
  name: string;
  imageUrl: string | null;
  followers: number | null;
  sourceUrl: string | null;
  sourceName: string | null;
  releases: Release[];
  related: RelatedArtist[];
  about?: ReactNode;
}) {
  const { play, current, state } = usePlayerControls();
  const [showAll, setShowAll] = useState(false);
  const { data, loading, retry } = useJson<SongsResponse>(
    `/api/search?q=${encodeURIComponent(query)}&limit=40`,
  );

  const { songs, filtered, cover } = useMemo(() => {
    const found = data?.songs ?? [];
    const theirs = found.filter((song) =>
      song.artists.some((credited) => creditNames(query, credited)),
    );
    return {
      songs: theirs.length > 0 ? theirs : found,
      filtered: theirs.length > 0,
      cover: imageUrl ?? theirs[0]?.artworkUrl ?? null,
    };
  }, [data, query, imageUrl]);

  const queueable = useMemo<Song[]>(() => {
    const from = { kind: "artist" as const, name, imageUrl: cover };
    return songs.map((song) => ({ ...song, from }));
  }, [songs, name, cover]);
  const visible = showAll ? queueable : queueable.slice(0, SONG_LIMIT);
  const source = sourceName && sourceStyle(sourceName).label;
  const reach = data ? `${songs.length} ${songs.length === 1 ? "song" : "songs"} Timbre can reach` : null;

  return (
    <Page>
      <DetailHeader
        art={<Artwork src={sized(cover, 640)} className={ARTIST_ART} iconClassName="size-10" eager />}
        eyebrow="Artist"
        title={name}
        meta={
          <>
            {followers !== null && source && (
              <span>
                {followers.toLocaleString()} followers on {source}
              </span>
            )}
            {followers !== null && source && reach && <Dot />}
            {reach && <span>{reach}</span>}
          </>
        }
      >
        {/* No `origin`: a `QueueOrigin` is a list with an id — a playlist, an album, a
            collection — and an artist's popular tracks are a selection this page made, with no
            id to compare against. The Play button reads Play rather than Pause because of it. */}
        <PlayRow songs={queueable}>
          {sourceUrl && source && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={DETAIL_SECONDARY}
            >
              Open on {source}
              <ExternalIcon className="size-3" />
            </a>
          )}
        </PlayRow>
      </DetailHeader>

      <section className="mb-7 sm:mb-9">
        <SectionRow title="Popular">
          {songs.length > SONG_LIMIT && (
            <button type="button" onClick={() => setShowAll(!showAll)} className={CHIP_OFF}>
              {showAll ? "Show fewer" : `Show all ${songs.length}`}
            </button>
          )}
        </SectionRow>

        {loading ? (
          <RowSkeletons size="sm" />
        ) : songs.length === 0 && (!data || data.failures.length > 0) ? (
          <EmptyNotice>
            Couldn&rsquo;t load {name}&rsquo;s songs.{" "}
            <button
              type="button"
              onClick={retry}
              className="font-semibold text-[var(--fg)] underline"
            >
              Try again
            </button>
          </EmptyNotice>
        ) : songs.length === 0 ? (
          <EmptyNotice>
            Nothing found for {name}. Try searching instead — the spelling may differ from the one
            Timbre was given.
          </EmptyNotice>
        ) : (
          <>
            {!filtered && (
              <Caption className="mb-2 px-1">
                No result credits {name} directly, so these are search matches for the name.
              </Caption>
            )}
            {/* Two columns once there is room for them, filled top to bottom before moving
                across, so the ranks still read in order. The row count is explicit because
                `grid-flow-col` would otherwise invent as many columns as it liked. */}
            <ul
              className="@4xl:grid @4xl:auto-cols-fr @4xl:grid-flow-col @4xl:gap-x-6"
              style={{ gridTemplateRows: `repeat(${Math.ceil(visible.length / 2)}, auto)` }}
            >
              {visible.map((song, position) => (
                <SongRow
                  key={song.id}
                  song={song}
                  onPlay={() => play(song, queueable)}
                  isCurrent={current?.id === song.id}
                  isPlaying={state === "playing"}
                  size="sm"
                  rank={
                    <TrackRank
                      position={position + 1}
                      playing={current?.id === song.id && state === "playing"}
                    />
                  }
                  rankPlays
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
          </>
        )}
      </section>

      {releases.length > 0 && <Discography releases={releases} />}

      {about}

      {related.length > 0 && (
        <Shelf title="Similar artists">
          {related.map((artist) => (
            <div key={artist.name} className={TILE}>
              <ArtistCard
                href={`/artist/${toArtistSlug(artist.name)}`}
                name={artist.name}
                imageUrl={artist.imageUrl}
              />
            </div>
          ))}
        </Shelf>
      )}
    </Page>
  );
}
