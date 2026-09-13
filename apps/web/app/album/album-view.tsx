"use client";

import Link from "next/link";

import type { AlbumDetail } from "@/lib/discography";

import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";
import { Artwork } from "../artwork";
import { PauseIcon, PlayIcon } from "../icons";
import { Caption, EmptyNotice, Page, PageHeader } from "../page-chrome";
import { usePlayerControls, type QueueOrigin } from "../player/player-context";
import { SaveAsPlaylist } from "../playlists/save-as-playlist";
import { SongActions, SongRow } from "../song-row";
import { ROW_BADGES, SourceBadges } from "../source-badges";
import type { Song } from "../types";

export function PlayRow({
  songs,
  origin,
  children,
}: {
  songs: Song[];
  origin?: QueueOrigin;
  children?: React.ReactNode;
}) {
  const { play, queueOrigin, state, toggle } = usePlayerControls();
  if (songs.length === 0 && !children) return null;

  // Playing *this* list, rather than merely playing something.
  const mine = origin !== undefined && queueOrigin?.id === origin.id;
  const playingMine = mine && state === "playing";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {songs.length > 0 && (
        <button
          type="button"
          onClick={() => (mine ? toggle() : play(songs[0]!, songs, undefined, origin))}
          className="slab-sm press inline-flex items-center gap-2 rounded-[var(--r-full)] px-5 py-2.5 text-sm font-bold text-[var(--accent-fg)]"
          style={{ background: "var(--accent)" }}
        >
          {playingMine ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          {playingMine ? "Pause" : "Play"}
        </button>
      )}
      {children}
    </div>
  );
}

export function AlbumView({ album }: { album: AlbumDetail }) {
  const { play, current, state } = usePlayerControls();
  const songs = album.songs as unknown as Song[];

  return (
    <Page>
      <PageHeader
        art={
          <Artwork
            src={album.coverUrl}
            className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-48"
            iconClassName="size-12"
            eager
          />
        }
        eyebrow={album.kind === "ep" ? "EP" : album.kind === "single" ? "Single" : "Album"}
        title={album.title}
      >
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-[var(--fg-dim)]">
          <Link
            href={`/artist/${toArtistSlug(album.artist)}`}
            className="font-semibold text-[var(--fg)] hover:underline"
          >
            {album.artist}
          </Link>
          {album.year && <span aria-hidden>·</span>}
          {album.year && <span>{album.year}</span>}
          <span aria-hidden>·</span>
          <span>
            {album.trackCount} {album.trackCount === 1 ? "track" : "tracks"}
          </span>
        </p>
        <PlayRow songs={songs}>
          {songs.length > 0 && (
            <SaveAsPlaylist key={album.id} name={`${album.title} — ${album.artist}`} songs={songs} />
          )}
        </PlayRow>
      </PageHeader>

      {songs.length === 0 ? (
        <EmptyNotice>No tracklist published for this release.</EmptyNotice>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {songs.map((song, position) => {
            const isCurrent = current?.id === song.id;
            return (
              <SongRow
                key={song.id}
                song={song}
                onPlay={() =>
                  play(song, [...songs.slice(position), ...songs.slice(0, position)])
                }
                isCurrent={isCurrent}
                isPlaying={state === "playing"}
                thumbnail={false}
                rank={
                  isCurrent && state === "playing" ? (
                    <span aria-label="Playing" className="text-[var(--accent)]">
                      &#9834;
                    </span>
                  ) : (
                    position + 1
                  )
                }
                subtitle={<ArtistLink artists={song.artists} />}
                trailing={
                  <>
                    <SourceBadges song={song} className={ROW_BADGES} />
                    <SongActions song={song} queue={false} />
                  </>
                }
              />
            );
          })}
        </ul>
      )}

      <Caption className="mt-8">
        Tracklist from Deezer. Picking a song finds a copy Timbre can play — every track still
        streams from the service it belongs to.
      </Caption>
    </Page>
  );
}
