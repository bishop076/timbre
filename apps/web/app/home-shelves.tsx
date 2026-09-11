"use client";

import { useEffect, useState } from "react";

import { toArtistSlug } from "./artist-slug";
import { usePlayerControls } from "./player/player-context";
import { useHistory, type PlayedSong } from "./player/history-store";
import { recentItems } from "./recent-items";
import { Shelf } from "./shelf";
import { SongCard, TILE } from "./song-card";
import { ArtistCard } from "./tile-cards";
import { TileSkeletons } from "./tile-skeleton";
import type { PlayContext, Song, SongsResponse } from "./types";

export function songFromHistory(entry: PlayedSong): Song {
  const played =
    entry.source && entry.sourceId
      ? [
          {
            source: entry.source,
            sourceId: entry.sourceId,
            url: entry.url ?? null,
            playback: entry.source === "spotify" ? ("manual" as const) : ("queue" as const),
          },
        ]
      : entry.videoId
        ? [
            {
              source: "ytmusic",
              sourceId: entry.videoId,
              url: `https://music.youtube.com/watch?v=${entry.videoId}`,
              playback: "queue" as const,
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
    sources: played,
    ...(entry.from ? { from: entry.from } : {}),
  };
}

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
      .catch(() => {
      });

    return () => aborter.abort();
  }, [seed?.videoId, seed?.title, seed?.artists]);

  if (history.length === 0) return <ForYouPending />;

  const items = recentItems(history, 12);
  const recentSongs: Song[] = items.flatMap((item) => (item.kind === "song" ? [songFromHistory(item.entry)] : []));
  const first = items[0];

  return (
    <>
      <Shelf
        title="Recently played"
        caption="Only on this device"
        resetKey={first ? (first.kind === "song" ? first.entry.id : `artist:${first.artist.name}`) : undefined}
      >
        {items.map((item) =>
          item.kind === "song" ? (
            <div key={item.entry.id} className={TILE}>
              <SongCard song={songFromHistory(item.entry)} queue={recentSongs} />
            </div>
          ) : (
            <div key={`artist:${item.artist.name}`} className={TILE}>
              <RecentArtist artist={item.artist} entries={item.entries} />
            </div>
          ),
        )}
      </Shelf>

      {radio.length > 0 && seed && (
        <Shelf title={`Because you played ${seed.title}`} caption="Blended across sources">
          {radio.map((song) => (
            <div key={song.id} className={TILE}>
              <SongCard song={song} queue={radio} />
            </div>
          ))}
        </Shelf>
      )}
    </>
  );
}

function RecentArtist({ artist, entries }: { artist: PlayContext; entries: PlayedSong[] }) {
  const { play, current, state } = usePlayerControls();
  const songs = entries.map(songFromHistory);
  const playing =
    state === "playing" && current?.from?.kind === "artist" && current.from.name.toLowerCase() === artist.name.toLowerCase();

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

function ForYouPending() {
  return (
    <div className="for-you-pending" aria-hidden>
      <Shelf title="Recently played" caption="Only on this device">
        <TileSkeletons count={8} className={TILE} />
      </Shelf>
    </div>
  );
}

export function HomeShelves({
  charts,
  failed = false,
}: {
  charts: SongsResponse | null;
  failed?: boolean;
}) {
  const songs = charts?.songs ?? [];

  const chartsFailed = failed || (charts !== null && songs.length === 0);
  const waiting = charts === null && !failed;

  return (
    <div className="rise pt-2">
      <ForYou />

      {(waiting || songs.length > 0) && (
        <Shelf title="Trending now" caption="Deezer · Apple Music">
          {waiting ? (
            <TileSkeletons count={8} className={TILE} />
          ) : (
            songs.slice(0, 12).map((song) => (
              <div key={song.id} className={TILE}>
                <SongCard song={song} queue={songs} />
              </div>
            ))
          )}
        </Shelf>
      )}

      {chartsFailed && (
        <p className="mb-6 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)] sm:mb-9">
          Charts aren&rsquo;t available right now. Search still works — try a song or artist
          above.
        </p>
      )}

      {songs.length > 12 && (
        <Shelf title="More to hear" caption="Further down the charts">
          {songs.slice(12, 24).map((song) => (
            <div key={song.id} className={TILE}>
              <SongCard song={song} queue={songs} />
            </div>
          ))}
        </Shelf>
      )}

      <p className="mt-2 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--fg-faint)]">
        Charts come from Deezer and Apple Music, which Timbre can&rsquo;t play directly — picking one
        searches for a copy it can. Everything plays from the service it belongs to.
      </p>
    </div>
  );
}
