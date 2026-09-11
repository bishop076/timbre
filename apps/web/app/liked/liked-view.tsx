"use client";

import { ArtistLink } from "../artist-link";
import { formatDuration } from "../duration";
import { HeartFilledIcon, PlayIcon } from "../icons";
import { EmptyNotice, Page, PageHeader } from "../page-chrome";
import { usePlayerControls } from "../player/player-context";
import { LikedCover } from "../playlists/liked-tile";
import { unlikeSong, useLikes } from "../playlists/likes-store";
import { SongRow } from "../song-row";
import { SourceBadges } from "../source-badges";

export function LikedView() {
  const { play, current, state } = usePlayerControls();
  const { songs, settled, error } = useLikes();

  if (!settled) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-7">
        <p className="text-sm text-[var(--fg-dim)]">Loading…</p>
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        art={
          <LikedCover
            className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-40"
            iconClassName="size-10 sm:size-14"
          />
        }
        eyebrow="Collection"
        title="Liked songs"
      >
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
      </PageHeader>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {songs.length === 0 ? (
        <EmptyNotice>
          Nothing liked yet. Press the heart beside what&rsquo;s playing, or right-click any
          song, and it lands here.
        </EmptyNotice>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {songs.map((song, position) => (
            <SongRow
              key={song.id}
              song={song}
              onPlay={() => play(song, [...songs.slice(position), ...songs.slice(0, position)])}
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
    </Page>
  );
}
