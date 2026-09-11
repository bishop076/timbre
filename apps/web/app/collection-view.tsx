"use client";

import { Artwork } from "./artwork";
import { sized } from "./artwork-url";
import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { Collage } from "./collage";
import { PlayIcon, ShuffleIcon } from "./icons";
import { Movement } from "./movement";
import { Page, PageHeader, SectionTitle } from "./page-chrome";
import { useHistory } from "./player/history-store";
import { usePlayerControls } from "./player/player-context";
import { SaveAsPlaylist } from "./playlists/save-as-playlist";
import { songFromHistory } from "./home-shelves";
import { Shelf } from "./shelf";
import { SongTiles } from "./song-card";
import { RankedList } from "./song-row";
import { ROW_BADGES, SourceBadges } from "./source-badges";
import { useTaste } from "./taste-store";
import type { Collection, CollectionKind } from "@/lib/collection";
import { seededShuffle } from "@/lib/rotation";

const EYEBROWS: Partial<Record<CollectionKind, string>> = {
  genre: "Genre",
  radio: "Station",
  "spotify-album": "Spotify album",
  "spotify-playlist": "Spotify playlist",
};

export function CollectionView({ collection }: { collection: Collection }) {
  const { play } = usePlayerControls();
  const { tracks } = collection;

  const chart = collection.sections.find((section) => section.ranked);
  const snapshot = useChartSnapshot(
    chart && collection.kind === "genre" ? Number(collection.id) : null,
    chart?.tracks ?? [],
  );

  function playAll(shuffled = false) {
    const queue = shuffled ? seededShuffle(tracks, Math.random() * 2 ** 32) : tracks;
    if (queue[0]) play(queue[0], queue);
  }

  return (
    <Page>
      <PageHeader
        art={
          collection.coverUrl ? (
            <Artwork
              src={sized(collection.coverUrl, 400)}
              eager
              iconClassName="size-7"
              className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-44"
            />
          ) : (
            <Collage covers={collection.covers} className="slab size-28 shrink-0 sm:size-44" />
          )
        }
        eyebrow={eyebrowOf(collection)}
        title={collection.title}
      >
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
          <SaveAsPlaylist
            key={`${collection.kind}:${collection.id}`}
            name={collection.title}
            songs={tracks}
          />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--fg-faint)]">
          Assembled from {collection.from} and kept nowhere.{" "}
          {collection.from === "YouTube Music"
            ? "Each song plays the upload the playlist holds; if YouTube will not embed one, another copy of the same recording plays instead."
            : "Playing a song searches for a copy Timbre can actually play, so an occasional match is a different upload of the same recording."}
          {snapshot && (
            <>
              {" "}
              Movement is against the last time you opened this chart — {describeAge(snapshot.at)},
              on this device.
            </>
          )}
        </p>
      </PageHeader>

      {collection.genreId !== null && <FromYourListening genreId={collection.genreId} />}

      {tracks.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--fg-dim)]">
          Nothing in this one right now.
        </p>
      ) : (
        collection.sections.map((section) => (
          <section key={section.key} className="mb-8 last:mb-0">
            {section.title && (
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                <SectionTitle>{section.title}</SectionTitle>
                {section.caption && (
                  <p className="text-[11px] text-[var(--fg-faint)]">{section.caption}</p>
                )}
              </div>
            )}

            <RankedList
              songs={section.tracks}
              queue={tracks}
              addToQueue
              extra={(track) => (
                <>
                  {section.ranked && (
                    <Movement delta={movementOf(snapshot, track.id, track.position)} />
                  )}
                  <SourceBadges song={track} className={ROW_BADGES} />
                </>
              )}
            />
          </section>
        ))
      )}
    </Page>
  );
}

function eyebrowOf({ kind, id, genreId }: Collection): string {
  if (kind === "genre" && genreId === null) return "Chart";
  if (kind === "ytmusic-playlist") {
    return id.startsWith("OLAK5uy_") ? "YouTube Music album" : "YouTube playlist";
  }
  return EYEBROWS[kind] ?? "Collection";
}

function FromYourListening({ genreId }: { genreId: number }) {
  const history = useHistory();
  const taste = useTaste();

  const songs = history
    .filter((entry) => entry.artists[0] && taste.genreOf(entry.artists[0]) === genreId)
    .slice(0, 12)
    .map(songFromHistory);

  if (songs.length === 0) return null;

  return (
    <Shelf title="From your listening" caption="Only on this device" resetKey={songs[0]?.id}>
      <SongTiles songs={songs} />
    </Shelf>
  );
}
