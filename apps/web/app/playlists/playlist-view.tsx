"use client";

import { ArtistLink } from "../artist-link";
import Link from "next/link";
import { useEffect } from "react";

import { ChevronIcon, NoteIcon, PlayIcon, TrashIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { sourceStyle } from "../sources";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { loadPlaylists, moveSong, removeSongAt, usePlaylist, usePlaylists } from "./store";

/**
 * One playlist, in full.
 *
 * Playing from here hands the whole list to the queue in order, which is what
 * makes a playlist different from a search result: the rest of the list is the
 * point, not an accident of what was on screen.
 *
 * A saved row carries the whole song — every source it was found on — so the
 * list renders and plays with no network at all. When a cached upload stops
 * working the player already falls through to another copy of the same song.
 */

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function PlaylistView({ id }: { id: string }) {
  const { play, current, state } = usePlayer();
  const { settled } = usePlaylists();
  const playlist = usePlaylist(id);

  useEffect(() => {
    loadPlaylists();
  }, []);

  // Storage has not been read yet — not the same as "no such playlist", and
  // showing "not found" first would flash a lie on every direct visit.
  if (!settled) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-7">
        <p className="text-sm text-[var(--fg-dim)]">Loading…</p>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-7">
        <h1 className="text-2xl font-extrabold tracking-tight">No such playlist</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--fg-dim)]">
          Playlists live in the browser they were made in. If you made this one somewhere else,
          export it there and import it here.
        </p>
        <Link
          href="/library"
          className="slab-sm press mt-5 inline-block rounded-[var(--r-md)] px-4 py-2 text-sm font-bold text-[var(--accent-fg)]"
          style={{ background: "var(--accent)" }}
        >
          Your library
        </Link>
      </div>
    );
  }

  const songs = playlist.songs;
  const covers = songs
    .map((song) => song.artworkUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 4);

  return (
    <div className="@container mx-auto w-full max-w-6xl px-5 pb-10 pt-6 sm:px-7">
      <header className="mb-7 flex flex-col gap-5 @lg:flex-row @lg:items-end">
        <PlaylistCover
          covers={covers}
          className="slab size-40 shrink-0 rounded-[var(--r-lg)]"
          iconClassName="size-10"
          eager
        />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            Playlist
          </p>
          <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight @lg:text-4xl">
            {playlist.name}
          </h1>
          <p className="mt-2 text-xs text-[var(--fg-faint)]">
            {songs.length} {songs.length === 1 ? "song" : "songs"} · only in this browser
          </p>

          <div className="mt-4 flex items-center gap-2">
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
            {/* Deleting from here has to navigate away — the page it is on is
                about to stop existing. */}
            <PlaylistActions id={playlist.id} name={playlist.name} onDeletedGoTo="/library" />
          </div>
        </div>
      </header>

      {songs.length === 0 ? (
        <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          Nothing here yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {songs.map((song, position) => {
            const isCurrent = current?.id === song.id;
            return (
              <li
                key={`${song.id}-${position}`}
                className={`group flex items-center gap-3 rounded-lg px-2 transition sm:gap-4 ${
                  isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-[var(--fg-faint)]">
                  {position + 1}
                </span>

                <button
                  type="button"
                  onClick={() => play(song, songs)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left focus:outline-none sm:gap-4"
                  aria-label={`Play ${song.title}`}
                >
                  <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-[var(--surface-1)]">
                    {song.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                      <img
                        src={song.artworkUrl}
                        alt=""
                        loading="lazy"
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
                      <ArtistLink artists={song?.artists ?? []} />
                    </span>
                  </span>
                </button>

                <div className="hidden shrink-0 items-center gap-1 @xl:flex">
                  {song.sources.map((source) => {
                    const style = sourceStyle(source.source);
                    return (
                      <span
                        key={source.source}
                        style={{ color: style.color, backgroundColor: style.tint }}
                        className="rounded-full px-2 py-0.5 text-xs font-medium opacity-0 transition group-hover:opacity-90"
                      >
                        {style.short}
                      </span>
                    );
                  })}
                </div>

                <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
                  {formatDuration(song.durationMs)}
                </span>

                {/*
                  Buttons rather than drag-and-drop. Dragging needs pointer
                  handlers, a drop indicator, autoscroll and a keyboard path
                  built separately; two buttons are reorderable by keyboard and
                  on a touch screen for free, and this list is short.
                */}
                <div className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => moveSong(playlist.id, position, position - 1)}
                    disabled={position === 0}
                    aria-label={`Move ${song.title} up`}
                    className="press flex size-7 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)] disabled:opacity-25 disabled:hover:bg-transparent"
                  >
                    <ChevronIcon className="size-4 rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSong(playlist.id, position, position + 1)}
                    disabled={position === songs.length - 1}
                    aria-label={`Move ${song.title} down`}
                    className="press flex size-7 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)] disabled:opacity-25 disabled:hover:bg-transparent"
                  >
                    <ChevronIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSongAt(playlist.id, position)}
                    aria-label={`Remove ${song.title} from ${playlist.name}`}
                    className="press mr-1 flex size-7 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] hover:bg-[var(--surface-1)] hover:text-red-400"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
