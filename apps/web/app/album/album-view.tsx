"use client";

import { toArtistSlug } from "../artist-slug";
import Link from "next/link";

import { ArtistLink } from "../artist-link";
import { Artwork } from "../artwork";
import { PlayIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import type { Song } from "../types";
import type { AlbumDetail } from "@/lib/discography";

/**
 * A release and its running order.
 *
 * Rows carry Deezer identity only, so nothing here is playable where it stands
 * — picking one hands it to the player, which searches for a copy it can drive.
 * That resolution is invisible and takes about as long as any other first play,
 * which is why the rows do not advertise it.
 */

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function AlbumView({ album }: { album: AlbumDetail }) {
  const { play, current, state } = usePlayer();
  // The shapes agree structurally; the cast keeps the wire type out of the
  // player's vocabulary rather than widening `Song` to know about Deezer.
  const songs = album.songs as unknown as Song[];

  return (
    <div className="@container mx-auto w-full max-w-6xl px-5 pb-10 pt-6 sm:px-7">
      <header className="mb-7 flex flex-col gap-5 @lg:flex-row @lg:items-end">
        <Artwork
          src={album.coverUrl}
          className="slab size-48 shrink-0 rounded-[var(--r-lg)]"
          iconClassName="size-12"
          eager
        />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            {album.kind === "ep" ? "EP" : album.kind === "single" ? "Single" : "Album"}
          </p>
          <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight @lg:text-4xl">
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
            <button
              type="button"
              onClick={() => play(songs[0]!, songs)}
              className="slab-sm press mt-4 inline-flex items-center gap-2 rounded-[var(--r-full)] px-5 py-2.5 text-sm font-bold text-[var(--accent-fg)]"
              style={{ background: "var(--accent)" }}
            >
              <PlayIcon className="size-4" />
              Play
            </button>
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
              <li
                key={song.id}
                className={`group flex items-center gap-3 rounded-lg px-2 transition sm:gap-4 ${
                  isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-[var(--fg-faint)]">
                  {isCurrent && state === "playing" ? (
                    <span aria-label="Playing" className="text-[var(--accent)]">
                      &#9834;
                    </span>
                  ) : (
                    position + 1
                  )}
                </span>

                <button
                  type="button"
                  onClick={() => play(song, songs)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left focus:outline-none"
                  aria-label={`Play ${song.title}`}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[15px] font-medium ${
                        isCurrent ? "text-[var(--accent)]" : ""
                      }`}
                    >
                      {song.title}
                    </span>
                    <span className="block truncate text-sm text-[var(--fg-dim)]">
                      <ArtistLink artists={song.artists} />
                    </span>
                  </span>
                </button>

                <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
                  {formatDuration(song.durationMs)}
                </span>

                <AddToPlaylist
                  song={song}
                  className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                />
              </li>
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
