"use client";

import { useEffect, useState } from "react";

import { toArtistSlug } from "./artist-slug";
import { Caption, EmptyNotice } from "./page-chrome";
import { usePlayerControls } from "./player/player-context";
import { useHistory, type PlayedSong } from "./player/history-store";
import { recentItems } from "./recent-items";
import { Shelf } from "./shelf";
import { SongCard, SongTiles, TILE } from "./song-card";
import { ArtistCard } from "./tile-cards";
import { TileSkeletons } from "./tile-skeleton";
import type { PlayContext, Song, SongsResponse } from "./types";

export function songFromHistory(entry: PlayedSong): Song {
  const sources: Song["sources"] =
    entry.source && entry.sourceId
      ? [
          {
            source: entry.source,
            sourceId: entry.sourceId,
            url: entry.url ?? null,
            playback: entry.source === "spotify" ? "manual" : "queue",
          },
        ]
      : entry.videoId
        ? [
            {
              source: "ytmusic",
              sourceId: entry.videoId,
              url: `https://music.youtube.com/watch?v=${entry.videoId}`,
              playback: "queue",
            },
          ]
        : [];

  return {
    id: entry.id,
    title: entry.title,
    artists: entry.artists,
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: entry.artworkUrl,
    sources,
    ...(entry.from ? { from: entry.from } : {}),
  };
}

const keyOf = (item: ReturnType<typeof recentItems>[number]) =>
  item.kind === "song" ? item.entry.id : `artist:${item.artist.name}`;

function ForYou() {
  const history = useHistory();
  const [radio, setRadio] = useState<Song[]>([]);

  const seed = history.find((entry) => entry.videoId);

  useEffect(() => {
    if (!seed?.videoId) return;

    const params = new URLSearchParams({ id: seed.videoId, title: seed.title, limit: "12" });
    const artist = seed.artists[0];
    if (artist) params.set("artist", artist);

    const aborter = new AbortController();
    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => setRadio(data?.songs ?? []))
      .catch(() => {});

    return () => aborter.abort();
  }, [seed?.videoId, seed?.title, seed?.artists]);

  if (history.length === 0) {
    return (
      <div className="for-you-pending" aria-hidden>
        <Shelf title="Recently played" caption="Only on this device">
          <TileSkeletons />
        </Shelf>
      </div>
    );
  }

  const items = recentItems(history, 12);
  const recentSongs = items.flatMap((item) =>
    item.kind === "song" ? [songFromHistory(item.entry)] : [],
  );

  return (
    <>
      <Shelf
        title="Recently played"
        caption="Only on this device"
        resetKey={items[0] && keyOf(items[0])}
      >
        {items.map((item) => (
          <div key={keyOf(item)} className={TILE}>
            {item.kind === "song" ? (
              <SongCard song={songFromHistory(item.entry)} queue={recentSongs} />
            ) : (
              <RecentArtist artist={item.artist} entries={item.entries} />
            )}
          </div>
        ))}
      </Shelf>

      {radio.length > 0 && seed && (
        <Shelf title={`Because you played ${seed.title}`} caption="Blended across sources">
          <SongTiles songs={radio} />
        </Shelf>
      )}
    </>
  );
}

function RecentArtist({ artist, entries }: { artist: PlayContext; entries: PlayedSong[] }) {
  const { play, current, state } = usePlayerControls();
  const songs = entries.map(songFromHistory);
  const playing =
    state === "playing" &&
    current?.from?.kind === "artist" &&
    current.from.name.toLowerCase() === artist.name.toLowerCase();

  return (
    <ArtistCard
      href={`/artist/${toArtistSlug(artist.name)}`}
      name={artist.name}
      imageUrl={artist.imageUrl}
      subtitle={entries.length === 1 ? "Artist · 1 song" : `Artist · ${entries.length} songs`}
      onPlay={() => songs[0] && play(songs[0], songs)}
      playing={playing}
    />
  );
}

export function HomeShelves({ charts, failed }: { charts: SongsResponse | null; failed: boolean }) {
  const songs = charts?.songs ?? [];
  const waiting = charts === null && !failed;

  return (
    <div className="rise pt-2">
      <ForYou />

      {(waiting || songs.length > 0) && (
        <Shelf title="Trending now" caption="Deezer · Apple Music">
          {waiting ? <TileSkeletons /> : <SongTiles songs={songs.slice(0, 12)} queue={songs} />}
        </Shelf>
      )}

      {(failed || (charts !== null && songs.length === 0)) && (
        <EmptyNotice className="mb-6 sm:mb-9">
          Charts aren&rsquo;t available right now. Search still works — try a song or artist
          above.
        </EmptyNotice>
      )}

      {songs.length > 12 && (
        <Shelf title="More to hear" caption="Further down the charts">
          <SongTiles songs={songs.slice(12, 24)} queue={songs} />
        </Shelf>
      )}

      <Caption className="mt-2 border-t border-[var(--line)] pt-5">
        Charts come from Deezer and Apple Music, which Timbre can&rsquo;t play directly — picking one
        searches for a copy it can. Everything plays from the service it belongs to.
      </Caption>
    </div>
  );
}
