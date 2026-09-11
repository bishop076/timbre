"use client";

import { ArtistLink } from "./artist-link";
import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { Collage } from "./collage";
import { PlayIcon, ShuffleIcon } from "./icons";
import { Movement } from "./movement";
import { AddToQueue } from "./player/add-to-queue";
import { usePlayerControls } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { SongRow } from "./song-row";
import { ROW_BADGES, SourceBadges } from "./source-badges";
import { songFromHistory } from "./home-shelves";
import { useHistory } from "./player/history-store";
import { Shelf } from "./shelf";
import { SongCard, TILE } from "./song-card";
import { useTaste } from "./taste-store";
import type { Song } from "./types";
import type { Collection } from "@/lib/collection";
import { cover as coverSrc } from "./artwork-url";

/**
 * One collection, one page — the same layout as every other detail page. Nothing is
 * stored; the page is assembled per request from Deezer and thrown away.
 */
export function CollectionView({ collection }: { collection: Collection }) {
  const { play, current, state } = usePlayerControls();
  const { tracks } = collection;

  // Movement only for a chart — a playlist's order is whatever its editor typed, and a
  // genre's new and on-air sections are a fresh deal each time. Pass `null`, never a spare
  // number: `-1` stopped it *writing* a snapshot but not reading one, and `-1` is the fused
  // ranking's key. See `chart-memory.ts`.
  const chart = collection.sections.find((section) => section.ranked);
  const snapshot = useChartSnapshot(
    chart && collection.kind === "genre" ? Number(collection.id) : null,
    chart?.tracks ?? [],
  );

  function playAll(shuffled = false) {
    if (tracks.length === 0) return;
    const queue = shuffled ? shuffle(tracks) : tracks;
    play(queue[0]!, queue);
  }

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
        {collection.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img
            src={coverSrc(collection.coverUrl, 400) ?? undefined}
            alt=""
            className="slab size-28 shrink-0 rounded-[var(--r-lg)] object-cover sm:size-44"
          />
        ) : (
          <Collage covers={collection.covers} className="slab size-28 shrink-0 sm:size-44" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            {eyebrowOf(collection)}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">
            {collection.title}
          </h1>
          <p className="mt-2 text-xs text-[var(--fg-faint)]">{collection.subtitle}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playAll()}
              disabled={tracks.length === 0}
              className="slab press flex items-center gap-2 rounded-[var(--r-full)] px-4 py-2 text-[13px] font-bold text-[var(--accent-fg)] disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              <PlayIcon className="size-4" />
              Play
            </button>
            <button
              type="button"
              onClick={() => playAll(true)}
              disabled={tracks.length === 0}
              className="slab-sm press flex items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-4 py-2 text-[13px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] disabled:opacity-40"
            >
              <ShuffleIcon className="size-4" />
              Shuffle
            </button>
          </div>

          {/* Said once here, not on every row. */}
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--fg-faint)]">
            Assembled from {collection.from} and kept nowhere. Playing a song searches for a copy Timbre can
            actually play, so an occasional match is a different upload of the same recording.
            {snapshot && (
              <>
                {" "}
                Movement is against the last time you opened this chart — {describeAge(snapshot.at)},
                on this device.
              </>
            )}
          </p>
        </div>
      </header>

      {collection.genreId !== null && (
        <FromYourListening genreId={collection.genreId} />
      )}

      {tracks.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--fg-dim)]">
          Nothing in this one right now.
        </p>
      ) : (
        collection.sections.map((section) => (
          <section key={section.key} className="mb-8 last:mb-0">
            {section.title && (
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{section.title}</h2>
                {section.caption && (
                  <p className="text-[11px] text-[var(--fg-faint)]">{section.caption}</p>
                )}
              </div>
            )}

            <ul className="divide-y divide-[var(--line)]">
              {section.tracks.map((track) => (
                <SongRow
                  key={track.id}
                  song={track}
                  // The whole page queues, not the section: pressing a new song and hearing
                  // nothing after the section ends reads as the player stopping.
                  onPlay={() => play(track, tracks)}
                  isCurrent={current?.id === track.id}
                  isPlaying={state === "playing"}
                  size="sm"
                  rank={track.position}
                  rankPlays
                  subtitle={<ArtistLink artists={track.artists} />}
                  trailing={
                    <>
                      {section.ranked && (
                        <Movement delta={movementOf(snapshot, track.id, track.position)} />
                      )}

                      <SourceBadges song={track} className={ROW_BADGES} />

                      <AddToQueue
                        song={track}
                        className="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
                      />
                      <AddToPlaylist
                        song={track}
                        className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                      />
                    </>
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** The word above the title: what kind of thing this page is. */
function eyebrowOf(collection: Collection): string {
  switch (collection.kind) {
    case "genre":
      return collection.genreId === null ? "Chart" : "Genre";
    case "radio":
      return "Station";
    case "spotify-album":
      return "Spotify album";
    case "spotify-playlist":
      return "Spotify playlist";
    default:
      return "Collection";
  }
}

/**
 * What this browser played in the page's genre, above everything Deezer sent. Nothing on the
 * server — history is in local storage — and nothing at all for a genre not played yet.
 */
function FromYourListening({ genreId }: { genreId: number }) {
  const history = useHistory();
  const taste = useTaste();

  const songs: Song[] = history
    .filter((entry) => entry.artists[0] && taste.genreOf(entry.artists[0]) === genreId)
    .slice(0, 12)
    .map(songFromHistory);

  if (songs.length === 0) return null;

  return (
    <Shelf title="From your listening" caption="Only on this device" resetKey={songs[0]?.id}>
      {songs.map((song) => (
        <div key={song.id} className={TILE}>
          <SongCard song={song} queue={songs} />
        </div>
      ))}
    </Shelf>
  );
}

/** Fisher–Yates on a copy. `sort(() => random - 0.5)` is measurably biased. */
function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}
