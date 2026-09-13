"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PlayRow } from "../album/album-view";
import { ArtistLink } from "../artist-link";
import { formatDuration } from "../duration";
import { ChevronIcon, TrashIcon } from "../icons";
import { EmptyNotice, Notice, Page, PageHeader } from "../page-chrome";
import { SearchField } from "../search-field";
import { usePlayerControls } from "../player/player-context";
import { SongRow } from "../song-row";
import { SourceBadges } from "../source-badges";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { loadPlaylists, moveSong, removeSongAt, usePlaylist, usePlaylists } from "./store";

/** Below this a playlist is short enough to scan, so the filter field stays out of the way. */
const FILTER_MIN = 10;

export function PlaylistView({ id }: { id: string }) {
  const [filter, setFilter] = useState("");
  const { play, current, state } = usePlayerControls();
  const { settled, error } = usePlaylists();
  const playlist = usePlaylist(id);

  useEffect(() => {
    loadPlaylists();
  }, []);

  if (!settled || !playlist) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-7">
        {!settled ? (
          <p className="text-sm text-[var(--fg-dim)]">Loading…</p>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">No such playlist</h1>
            <Notice className="mt-2 max-w-prose">
              Playlists live in the browser they were made in. If you made this one somewhere
              else, export it there and import it here.
            </Notice>
            <Link
              href="/library"
              className="slab-sm press mt-5 inline-block rounded-[var(--r-md)] px-4 py-2 text-sm font-bold text-[var(--accent-fg)]"
              style={{ background: "var(--accent)" }}
            >
              Your library
            </Link>
          </>
        )}
      </div>
    );
  }

  const { songs } = playlist;
  const origin = { kind: "playlist" as const, id: playlist.id };
  // The filter field only renders past FILTER_MIN songs, but `filter` lives above it and
  // nothing reset it: filtering an 11-song playlist and then deleting matched songs until
  // nine were left unmounted the field with the term still set, leaving "Nothing in this
  // playlist matches …" and no control anywhere to clear it — the survivors were unreachable
  // without a reload. Deriving the term from whether the field is on screen means the state
  // cannot outlive the only thing that can clear it.
  const filtering = songs.length >= FILTER_MIN;
  const term = filtering ? filter.trim().toLowerCase() : "";
  // `${id}-${position}` changed on both rows of every move, so React unmounted and remounted
  // them instead of moving them — and the arrows live in a `group-hover` wrapper, so the
  // button just clicked vanished from under the pointer. Numbering only the repeats of an id
  // gives a key that a reorder does not disturb, while still being unique when a playlist
  // holds the same song twice.
  const seen = new Map<string, number>();
  const visible = songs
    .map((song, position) => {
      const repeat = seen.get(song.id) ?? 0;
      seen.set(song.id, repeat + 1);
      return { song, position, key: repeat === 0 ? song.id : `${song.id}#${repeat}` };
    })
    .filter(
      ({ song }) =>
        term === "" ||
        song.title.toLowerCase().includes(term) ||
        song.artists.some((artist) => artist.toLowerCase().includes(term)),
    );

  return (
    <Page>
      <PageHeader
        art={
          <PlaylistCover
            covers={songs.flatMap((song) => song.artworkUrl || [])}
            className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-40"
            iconClassName="size-10"
            eager
          />
        }
        eyebrow="Playlist"
        title={playlist.name}
      >
        <p className="mt-2 text-xs text-[var(--fg-faint)]">
          {songs.length} {songs.length === 1 ? "song" : "songs"}
        </p>
        <PlayRow songs={songs} origin={origin}>
          <PlaylistActions id={playlist.id} name={playlist.name} onDeletedGoTo="/library" />
        </PlayRow>
      </PageHeader>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">Songs</h2>

        {term !== "" && (
          <p className="shrink-0 text-xs tabular-nums text-[var(--fg-faint)]">
            {visible.length} of {songs.length}
          </p>
        )}
      </div>

      {filtering && (
        <SearchField
          value={filter}
          onChange={setFilter}
          onClear={() => setFilter("")}
          placeholder="Find in playlist"
          label={`Find a song in ${playlist.name}`}
          clearLabel="Clear filter"
          className="mb-3"
        />
      )}

      {visible.length === 0 ? (
        <EmptyNotice>
          {songs.length === 0 ? (
            "Nothing here yet."
          ) : (
            <>Nothing in this playlist matches &ldquo;{filter.trim()}&rdquo;.</>
          )}
        </EmptyNotice>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {visible.map(({ song, position, key }) => (
            <SongRow
              key={key}
              song={song}
              onPlay={() =>
                play(
                  song,
                  [...songs.slice(position), ...songs.slice(0, position)],
                  undefined,
                  origin,
                )
              }
              isCurrent={current?.id === song.id}
              isPlaying={state === "playing"}
              rank={position + 1}
              subtitle={<ArtistLink artists={song.artists} />}
              trailing={
                <>
                  <SourceBadges
                    song={song}
                    className="hidden opacity-0 transition group-hover:opacity-100 @xl:flex"
                  />

                  <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
                    {formatDuration(song.durationMs)}
                  </span>

                  <div className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                    {term === "" &&
                      [-1, 1].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => moveSong(playlist.id, position, position + step)}
                          disabled={position + step < 0 || position + step >= songs.length}
                          aria-label={`Move ${song.title} ${step < 0 ? "up" : "down"}`}
                          className="press flex size-7 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)] disabled:opacity-25 disabled:hover:bg-transparent"
                        >
                          <ChevronIcon className={step < 0 ? "size-4 rotate-180" : "size-4"} />
                        </button>
                      ))}
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
    </Page>
  );
}
