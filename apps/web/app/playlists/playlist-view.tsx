"use client";

import { ArtistLink } from "../artist-link";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ChevronIcon, CloseIcon, NoteIcon, PlayIcon, SearchIcon, TrashIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { sourceStyle } from "../sources";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { loadPlaylists, moveSong, removeSongAt, usePlaylist, usePlaylists } from "./store";
import { cover as coverSrc } from "../artwork-url";

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
  /*
   * Finding a song in this playlist, which is not the same question as search.
   *
   * The shell's field asks the catalogue; this asks the forty rows in front of
   * you. They used to be one box — the shell's — sitting above every page, and
   * typing in it here threw you out to a global result set, which reads as the
   * field ignoring the page it is on. See `top-bar.tsx`.
   *
   * Local state, not the search store, precisely so the two cannot bleed into
   * one another: leaving and coming back should not restore a filter that hides
   * most of the playlist with no obvious cause.
   */
  const [filter, setFilter] = useState("");
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

  /*
   * Filtering carries each song's *real* index with it.
   *
   * Every row control here is index-based — `moveSong(id, from, to)` and
   * `removeSongAt(id, position)` address the stored array, not the screen. Map
   * first and filter second, and the position travels with the song, so a
   * delete while filtered removes the row you clicked rather than whatever
   * happens to sit at that offset in the shortened list.
   */
  const term = filter.trim().toLowerCase();
  const visible = songs
    .map((song, position) => ({ song, position }))
    .filter(
      ({ song }) =>
        term === "" ||
        song.title.toLowerCase().includes(term) ||
        song.artists.some((artist) => artist.toLowerCase().includes(term)),
    );

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
        <PlaylistCover
          covers={covers}
          className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-40"
          iconClassName="size-10"
          eager
        />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            Playlist
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">
            {playlist.name}
          </h1>
          <p className="mt-2 text-xs text-[var(--fg-faint)]">
            {/*
              Just the count. "Only in this browser" was appended to every
              playlist, and a promise repeated on every page stops being a
              promise and becomes furniture — it is the same sentence whatever
              you are looking at, so it carries no information about *this*
              playlist and pushes the one number that does out of the way.

              It is still said, once, where it answers a question somebody is
              actually asking: on the library page above the whole collection,
              and in Settings beside the rest of what this browser is holding.
            */}
            {songs.length} {songs.length === 1 ? "song" : "songs"}
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

      {/*
        Small, and only once there is enough to lose something in.

        A filter over three rows is a control that costs more attention than the
        looking it saves, so it appears at ten — the point where the list stops
        fitting on a phone screen.
      */}
      {songs.length >= 10 && (
        <div className="mb-3 flex items-center justify-end gap-3">
          {term !== "" && (
            <p className="text-xs tabular-nums text-[var(--fg-faint)]">
              {visible.length} of {songs.length}
            </p>
          )}

          <div className="relative w-full max-w-[210px]">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-faint)]" />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Find in playlist"
              aria-label={`Find a song in ${playlist.name}`}
              className="slab-sm w-full rounded-[var(--r-full)] bg-[var(--surface-2)] py-1.5 pl-8 pr-8 text-[12px] font-medium outline-none placeholder:font-normal placeholder:text-[var(--fg-faint)] focus:bg-[var(--surface-1)]"
            />
            {filter !== "" && (
              <button
                type="button"
                onClick={() => setFilter("")}
                aria-label="Clear filter"
                className="press absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] hover:text-[var(--fg)]"
              >
                <CloseIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {songs.length === 0 ? (
        <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          Nothing here yet.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          Nothing in this playlist matches &ldquo;{filter.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {visible.map(({ song, position }) => {
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
                  {/*
                    No reordering while a filter is on.

                    The arrows move a song one place in the *stored* list, and
                    while rows are hidden that neighbour is usually one of the
                    hidden ones — so the press would be correct, change the
                    playlist, and appear to do nothing at all. Removing is
                    unambiguous either way and stays.
                  */}
                  {term === "" && (
                    <>
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
                    </>
                  )}
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
