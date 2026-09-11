"use client";

import { toArtistSlug } from "../artist-slug";
import Link from "next/link";

import { ArtistLink } from "../artist-link";
import { Artwork } from "../artwork";
import { PlayIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import { SaveAsPlaylist } from "../playlists/save-as-playlist";
import { SongRow } from "../song-row";
import { ROW_BADGES, SourceBadges } from "../source-badges";
import type { Song } from "../types";
import type { AlbumDetail } from "@/lib/discography";
import { formatDuration } from "../duration";

export function AlbumView({ album }: { album: AlbumDetail }) {
  const { play, current, state } = usePlayerControls();
  const songs = album.songs as unknown as Song[];

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
        <Artwork
          src={album.coverUrl}
          className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-48"
          iconClassName="size-12"
          eager
        />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            {album.kind === "ep" ? "EP" : album.kind === "single" ? "Single" : "Album"}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">
            {album.title}
          </h1>

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

          {songs.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => play(songs[0]!, songs)}
                className="slab-sm press inline-flex items-center gap-2 rounded-[var(--r-full)] px-5 py-2.5 text-sm font-bold text-[var(--accent-fg)]"
                style={{ background: "var(--accent)" }}
              >
                <PlayIcon className="size-4" />
                Play
              </button>
              <SaveAsPlaylist key={album.id} name={`${album.title} — ${album.artist}`} songs={songs} />
            </div>
          )}
        </div>
      </header>

      {songs.length === 0 ? (
        <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          No tracklist published for this release.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {songs.map((song, position) => {
            const isCurrent = current?.id === song.id;
            return (
              <SongRow
                key={song.id}
                song={song}
                onPlay={() => play(song, songs)}
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

                    <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
                      {formatDuration(song.durationMs)}
                    </span>

                    <AddToPlaylist
                      song={song}
                      className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                    />
                  </>
                }
              />
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-xs leading-relaxed text-[var(--fg-faint)]">
        Tracklist from Deezer. Picking a song finds a copy Timbre can play — every track still
        streams from the service it belongs to.
      </p>
    </div>
  );
}
