"use client";

import {
  AlbumCell,
  DETAIL_ART,
  DetailHeader,
  Dot,
  PlayRow,
  TAIL_TWO,
  TimeCell,
  TrackHead,
  totalTime,
} from "./album/detail-chrome";
import { Artwork } from "./artwork";
import { sized } from "./artwork-url";
import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { Collage } from "./collage";
import { Movement } from "./movement";
import { Page, SectionTitle } from "./page-chrome";
import { useHistory } from "./player/history-store";
import { collectionOrigin } from "./player/queue-origin.ts";
import { SaveAsPlaylist } from "./playlists/save-as-playlist";
import { songFromHistory } from "./home-shelves";
import { Shelf } from "./shelf";
import { SongTiles } from "./song-card";
import { RankedList } from "./song-row";
import { ROW_BADGES, SourceBadges } from "./source-badges";
import { useTaste } from "./taste-store";
import type { Collection, CollectionKind } from "@/lib/collection";

const EYEBROWS: Partial<Record<CollectionKind, string>> = {
  genre: "Genre",
  radio: "Station",
  "spotify-album": "Spotify album",
  "spotify-playlist": "Spotify playlist",
};

export function CollectionView({ collection }: { collection: Collection }) {
  const { tracks } = collection;

  const chart = collection.sections.find((section) => section.ranked);
  const snapshot = useChartSnapshot(
    chart && collection.kind === "genre" ? Number(collection.id) : null,
    chart?.tracks ?? [],
  );
  const length = totalTime(tracks);

  return (
    <Page>
      <DetailHeader
        art={
          collection.coverUrl ? (
            <Artwork
              src={sized(collection.coverUrl, 400)}
              eager
              iconClassName="size-7"
              className={DETAIL_ART}
            />
          ) : (
            <Collage covers={collection.covers} className={DETAIL_ART} rounded="" />
          )
        }
        eyebrow={eyebrowOf(collection)}
        title={collection.title}
        meta={
          <>
            <span>{collection.subtitle}</span>
            {length && <Dot />}
            {length && <span>{length}</span>}
          </>
        }
        note={
          <>
            Assembled from {collection.from} and kept nowhere.{" "}
            {collection.from === "YouTube Music"
              ? "Each song plays the upload the playlist holds; if YouTube will not embed one, another copy of the same recording plays instead."
              : "Playing a song searches for a copy Timbre can actually play, so an occasional match is a different upload of the same recording."}
            {/* The sentence is server-rendered whenever this collection *has* a ranked section;
                only the age of the snapshot has to wait for storage. It used to appear whole on
                hydration, growing the note by a line and pushing the tracklist down under the
                reader's pointer. `noteLines` holds the taller shape from the first paint. */}
            {chart && (
              <>
                {" "}
                Movement is against the last time you opened this chart
                {snapshot ? ` — ${describeAge(snapshot.at)}` : ""}, on this device.
              </>
            )}
          </>
        }
        noteLines={chart ? 3 : undefined}
      >
        {/* `QueueOrigin` knew only playlists and albums, so this button could not tell "playing
            this chart" from "playing something" and read Play while its own tracks played. */}
        <PlayRow songs={tracks} shuffle origin={collectionOrigin(collection.kind, collection.id)}>
          <SaveAsPlaylist
            key={`${collection.kind}:${collection.id}`}
            name={collection.title}
            songs={tracks}
            coverUrl={collection.coverUrl}
          />
        </PlayRow>
      </DetailHeader>

      {collection.genreId !== null && <FromYourListening genreId={collection.genreId} />}

      {tracks.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--fg-dim)]">
          Nothing in this one right now.
        </p>
      ) : (
        collection.sections.map((section) => (
          <section key={section.key} className="mb-6 last:mb-0">
            {section.title && (
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
                <SectionTitle>{section.title}</SectionTitle>
                {section.caption && (
                  <p className="text-[11px] text-[var(--fg-faint)]">{section.caption}</p>
                )}
              </div>
            )}

            <TrackHead album tail={TAIL_TWO} />

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
                  <AlbumCell name={track.album} />
                  <TimeCell ms={track.durationMs} />
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
