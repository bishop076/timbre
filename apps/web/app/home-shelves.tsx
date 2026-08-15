"use client";

import { useEffect, useState } from "react";

import { useHistory } from "./player/history-store";
import { Shelf } from "./shelf";
import { SongCard } from "./song-card";
import { TileSkeletons } from "./tile-skeleton";
import type { Song, SongsResponse } from "./types";

/**
 * The home page's shelves.
 *
 * Split out of `search-results.tsx`, which had grown to hold both halves of two
 * different pages: the search results and everything Home renders. Because
 * `home-view.tsx` imported `HomeShelves` from there, `/` was downloading the
 * whole search-results view and `/search` was downloading all of this — each
 * route carrying the other's page for nothing.
 *
 * Nothing here is shared with search any more, which is what makes the two
 * separable at all.
 */

/*
 * One tile's width.
 *
 * 9.5rem left barely two covers on a phone, so a shelf read as a stack of
 * posters rather than a row to browse — the point of a shelf is that the next
 * item is already visible. 7rem fits three with the fourth cut, which is the
 * cue that says "this scrolls" without an arrow.
 */
const TILE = "w-[7rem] shrink-0 sm:w-[10.5rem]";

/**
 * Shelves built from what you have listened to.
 *
 * Both render nothing on a first visit, so a cold home page is exactly what it
 * was before this existed. History lives in localStorage and never leaves the
 * browser — see `history-store.ts`.
 */
function ForYou() {
  const history = useHistory();
  const [radio, setRadio] = useState<Song[]>([]);

  // The most recent play that can seed a radio. A song whose every copy
  // refused to embed has no upload id and cannot start one.
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

  /*
   * Nothing played — or nothing *read yet*, which is not the same thing and was
   * being treated as though it were.
   *
   * `useHistory` returns empty from `getServerSnapshot`, because the server has
   * no storage to read. So on every load this returned `null`, the page rendered
   * the arrangement a **first-time visitor** should see — "Trending now" at the
   * top and no personalised shelves — and then hydration inserted two shelves
   * above it and shoved the whole page down. A returning listener saw the guest
   * layout first, every single time.
   *
   * The placeholder reserves what is coming. Which of the two cases this is
   * cannot be known here — the markup is identical for both — but it *can* be
   * known before the first paint: the boot script sets `data-listener` on
   * `<html>` when this browser has a history, and `globals.css` shows this only
   * then. A genuine guest has no such attribute and sees nothing, which is
   * correct for them.
   */
  if (history.length === 0) return <ForYouPending />;

  // Recently-played entries are stored flat rather than as whole songs, so
  // they are given the minimum a card needs. Playing one re-resolves it, the
  // same path a Deezer chart entry already takes.
  const recent: Song[] = history.slice(0, 12).map((entry) => ({
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
  }));

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

/**
 * The space "Recently played" will occupy, held open until it can be filled.
 *
 * Shown only when `<html>` carries `data-listener` — see the `.for-you-pending`
 * rule in `globals.css`. That attribute is the one thing about a listener's
 * history the first paint can know, so it is what decides whether there is
 * anything to reserve.
 *
 * One shelf, not two. "Recently played" is certain for anyone with a history;
 * "Because you played X" depends on a request that may return nothing, and
 * reserving room for a shelf that never arrives would leave a hole instead of
 * closing one.
 */
function ForYouPending() {
  return (
    <div className="for-you-pending" aria-hidden>
      <Shelf title="Recently played" caption="Only on this device">
        <TileSkeletons count={8} className={TILE} />
      </Shelf>
    </div>
  );
}

export function HomeShelves({ charts }: { charts: SongsResponse | null }) {
  const songs = charts?.songs ?? [];

  /*
   * Charts arrived, and there are none.
   *
   * Left alone this rendered an empty shelf under a "Trending now" heading —
   * a page that looks like it finished loading and simply has nothing to say,
   * which is indistinguishable from the app being broken. Skeletons are not the
   * answer either: they promise something is still coming when nothing is.
   */
  const chartsFailed = charts !== null && songs.length === 0;

  return (
    <div className="rise pt-2">
      <ForYou />

      <Shelf title="Trending now" caption="Deezer · Apple Music">
        {charts === null ? (
          <TileSkeletons count={8} className={TILE} />
        ) : (
          songs.slice(0, 12).map((song) => (
            <div key={song.id} className={TILE}>
              <SongCard song={song} queue={songs} />
            </div>
          ))
        )}
      </Shelf>

      {/* Search still works when the charts do not, so this says so rather than
          implying the whole app is down. */}
      {chartsFailed && (
        <p className="-mt-2 px-1 text-sm leading-relaxed text-[var(--fg-dim)]">
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
