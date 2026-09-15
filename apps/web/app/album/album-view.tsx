"use client";

import Link from "next/link";

import type { AlbumDetail } from "@/lib/discography";

import { ArtistLink } from "../artist-link";
import { toArtistSlug } from "../artist-slug";
import { Artwork } from "../artwork";
import { Caption, EmptyNotice, Page } from "../page-chrome";
import { usePlayerControls } from "../player/player-context";
import { SaveAsPlaylist } from "../playlists/save-as-playlist";
import { SongActions, SongRow } from "../song-row";
import { ROW_BADGES, SourceBadges } from "../source-badges";
import type { Song } from "../types";
import {
  DETAIL_ART,
  DetailHeader,
  Dot,
  PlayRow,
  TAIL_ONE,
  TrackHead,
  TrackRank,
  totalTime,
} from "./detail-chrome";

// `PlayRow` moved to detail-chrome.tsx, beside the rest of the detail-page furniture. The artist
// page and the playlist view both import it from here, so the name stays exported from here too.
export { PlayRow } from "./detail-chrome";

export function AlbumView({ album }: { album: AlbumDetail }) {
  const { play, current, state } = usePlayerControls();
  const songs = album.songs as unknown as Song[];
  // The header button had no origin at all, so `mine` was always false: it read Play while the
  // album was playing, and pressing it restarted from track 1 instead of pausing.
  const albumOrigin = { kind: "album" as const, id: String(album.id) };
  const length = totalTime(songs);

  return (
    <Page>
      <DetailHeader
        art={
          <Artwork src={album.coverUrl} className={DETAIL_ART} iconClassName="size-10" eager />
        }
        eyebrow={album.kind === "ep" ? "EP" : album.kind === "single" ? "Single" : "Album"}
        title={album.title}
        meta={
          <>
            <Link
              href={`/artist/${toArtistSlug(album.artist)}`}
              className="font-semibold text-[var(--fg)] hover:underline"
            >
              {album.artist}
            </Link>
            {album.year && <Dot />}
            {album.year && <span>{album.year}</span>}
            <Dot />
            <span>
              {album.trackCount} {album.trackCount === 1 ? "track" : "tracks"}
            </span>
            {length && <Dot />}
            {length && <span>{length}</span>}
          </>
        }
      >
        <PlayRow songs={songs} origin={albumOrigin} shuffle>
          {songs.length > 0 && (
            <SaveAsPlaylist key={album.id} name={`${album.title} — ${album.artist}`} songs={songs} />
          )}
        </PlayRow>
      </DetailHeader>

      {songs.length === 0 ? (
        <EmptyNotice>No tracklist published for this release.</EmptyNotice>
      ) : (
        <>
          {/* No Album column here — every row would repeat the title at the top of the page. */}
          <TrackHead tail={TAIL_ONE} />
          <ul className="divide-y divide-[var(--line)]">
            {songs.map((song, position) => {
              const isCurrent = current?.id === song.id;
              // A tracklist is one artist's, nearly always. Repeating that name under all
              // thirteen titles costs a second line per row and says nothing; a compilation, or
              // a guest on one track, still gets its credit because the names differ there.
              const credited = song.artists.join(", ") !== album.artist;
              return (
                <SongRow
                  key={song.id}
                  song={song}
                  onPlay={() =>
                    play(
                      song,
                      [...songs.slice(position), ...songs.slice(0, position)],
                      undefined,
                      albumOrigin,
                    )
                  }
                  isCurrent={isCurrent}
                  isPlaying={state === "playing"}
                  size="sm"
                  thumbnail={false}
                  rank={
                    <TrackRank position={position + 1} playing={isCurrent && state === "playing"} />
                  }
                  subtitle={credited ? <ArtistLink artists={song.artists} /> : null}
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
        </>
      )}

      <Caption className="mt-6">
        Tracklist from Deezer. Picking a song finds a copy Timbre can play — every track still
        streams from the service it belongs to.
      </Caption>
    </Page>
  );
}
