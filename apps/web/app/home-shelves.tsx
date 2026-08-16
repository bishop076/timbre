"use client";

import { useEffect, useState } from "react";

import { useHistory, type PlayedSong } from "./player/history-store";
import { Shelf } from "./shelf";
import { SongCard } from "./song-card";
import { TileSkeletons } from "./tile-skeleton";
import type { Song, SongsResponse } from "./types";

// The home page's shelves. Split out of `search-results.tsx` so `/` no longer downloads
// the search view and `/search` no longer downloads this.

// One tile's width. At 9.5rem a phone showed barely two covers; 7rem fits three with
// the fourth cut, which is the cue that says "this scrolls" without an arrow.
const TILE = "w-[7rem] shrink-0 sm:w-[10.5rem]";

/** History is stored flat, so an entry gets the minimum a card needs. Without an upload id
 * there is nothing to play, and the card falls back to searching. */
export function songFromHistory(entry: PlayedSong): Song {
  return {
    id: entry.id,
    title: entry.title,
    artists: entry.artists,
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: entry.artworkUrl,
    sources: entry.videoId
      ? [
          {
            source: "ytmusic",
            sourceId: entry.videoId,
            url: `https://music.youtube.com/watch?v=${entry.videoId}`,
            playback: "queue" as const,
          },
        ]
      : [],
  };
}

/** Shelves built from what you have listened to; nothing on a first visit. */
function ForYou() {
  const history = useHistory();
  const [radio, setRadio] = useState<Song[]>([]);

  // The most recent play that can seed a radio — a song whose every copy refused to
  // embed has no upload id.
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
        // A missing shelf is not worth an error message.
      });

    return () => aborter.abort();
  }, [seed?.videoId, seed?.title, seed?.artists]);

  // Nothing played — or nothing *read yet*, which is not the same thing. `useHistory`
  // returns empty from `getServerSnapshot`, so a returning listener got the guest layout on
  // every load and then had two shelves inserted above it by hydration. `data-listener` on
  // `<html>` is the one thing the first paint can know, and `globals.css` gates on it.
  if (history.length === 0) return <ForYouPending />;

  const recent: Song[] = history.slice(0, 12).map(songFromHistory);

  return (
    <>
      <Shelf title="Recently played" caption="Only on this device" resetKey={recent[0]?.id}>
        {recent.map((song) => (
          <div key={song.id} className={TILE}>
            <SongCard song={song} queue={recent} />
          </div>
        ))}
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

/** The space "Recently played" will occupy — see `.for-you-pending` in `globals.css`. One
 * shelf, not two: "Because you played X" depends on a request that may return nothing. */
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
  /**
   * The request answered and there is nothing to show — as opposed to still waiting.
   *
   * Without this the two were the same `null`, so a refused or unreachable /api/charts
   * left eight skeletons pulsing under "Trending now" for ever, and the sentence below
   * was unreachable.
   */
  failed = false,
}: {
  charts: SongsResponse | null;
  failed?: boolean;
}) {
  const songs = charts?.songs ?? [];

  // Either the request failed, or it answered with an empty chart. An empty shelf under a
  // heading is indistinguishable from the app being broken, and skeletons promise more.
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

      {/* No shelf is drawn in this state, so this is not tucked under one. */}
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
