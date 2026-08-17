"use client";

import { ArtistLink } from "../artist-link";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ChevronIcon, CloseIcon, PlayIcon, SearchIcon, TrashIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { SongRow } from "../song-row";
import { sourceStyle } from "../sources";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { loadPlaylists, moveSong, removeSongAt, usePlaylist, usePlaylists } from "./store";
import { formatDuration } from "../duration";

// A saved row carries the whole song — every source it was found on — so the list renders
// and plays with no network at all.


/** One playlist, in full. */
export function PlaylistView({ id }: { id: string }) {
  // Finds a song in *this* playlist, not the catalogue (see `top-bar.tsx`). Local state,
  // not the search store, so returning can't restore a hidden filter.
  const [filter, setFilter] = useState("");
  const { play, current, state } = usePlayerControls();
  const { settled } = usePlaylists();
  const playlist = usePlaylist(id);

  useEffect(() => {
    loadPlaylists();
  }, []);

  // Storage unread is not "no such playlist" — "not found" first flashes a lie.
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

  // Map first, filter second, so each song carries its *stored* index — the row controls
  // address that array, and otherwise a delete hits the wrong offset.
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
            {/* Just the count — "only in this browser" is said once, on the library page. */}
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
            {/* Deleting has to navigate away — this page is about to stop existing. */}
            <PlaylistActions id={playlist.id} name={playlist.name} onDeletedGoTo="/library" />
          </div>
        </div>
      </header>

      {/* Ten is where the list stops fitting a phone screen; below that a filter
          costs more attention than the looking it saves. */}
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
          {visible.map(({ song, position }) => (
            <SongRow
              key={`${song.id}-${position}`}
              song={song}
              onPlay={() => play(song, songs)}
              isCurrent={current?.id === song.id}
              isPlaying={state === "playing"}
              rank={position + 1}
              subtitle={<ArtistLink artists={song?.artists ?? []} />}
              trailing={
                <>
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

                  {/* Buttons, not drag-and-drop: these work by keyboard and touch for free. */}
                  <div className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                    {/* No reordering while filtered: the arrows move a song one place in the
                        *stored* list, whose neighbour is usually hidden, so the press
                        changes the playlist and appears to do nothing. */}
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
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
