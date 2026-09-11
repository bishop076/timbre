"use client";

import { useEffect } from "react";

import { ArtistLink } from "../artist-link";
import { formatDuration } from "../duration";
import { HeartFilledIcon, PlayIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { LikedCover } from "../playlists/liked-tile";
import { loadLikes, unlikeSong, useLikes } from "../playlists/likes-store";
import { SongRow } from "../song-row";
import { SourceBadges } from "../source-badges";

export function LikedView() {
  const { play, current, state } = usePlayerControls();
  const { songs, settled, error } = useLikes();

  useEffect(() => {
    loadLikes();
  }, []);

  if (!settled) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-7">
        <p className="text-sm text-[var(--fg-dim)]">Loading…</p>
      </div>
    );
  }

  const from = (position: number) => [...songs.slice(position), ...songs.slice(0, position)];

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
        <LikedCover
          className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-40"
          iconClassName="size-10 sm:size-14"
        />

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            Collection
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">
            Liked songs
          </h1>
          <p className="mt-2 text-xs text-[var(--fg-faint)]">
            {songs.length} {songs.length === 1 ? "song" : "songs"} · only on this device
          </p>

          {songs.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => play(songs[0]!, songs)}
                className="slab-sm press inline-flex items-center gap-2 rounded-[var(--r-full)] px-5 py-2.5 text-sm font-bold text-[var(--accent-fg)]"
                style={{ background: "var(--accent)" }}
              >
                <PlayIcon className="size-4" />
                Play
              </button>
            </div>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {songs.length === 0 ? (
        <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
          Nothing liked yet. Press the heart beside what&rsquo;s playing, or right-click any
          song, and it lands here.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {songs.map((song, position) => (
            <SongRow
              key={song.id}
              song={song}
              onPlay={() => play(song, from(position))}
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

                  <button
                    type="button"
                    onClick={() => unlikeSong(song)}
                    aria-label={`Remove ${song.title} from Liked songs`}
                    title="Remove from Liked songs"
                    className="press tint mr-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--accent)] hover:bg-[var(--surface-1)]"
                  >
                    <HeartFilledIcon className="size-[18px]" />
                  </button>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
