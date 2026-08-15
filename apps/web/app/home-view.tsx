"use client";

import { useEffect, useState } from "react";

import { rememberCharts, useCachedCharts } from "./charts-cache";
import { MixHero } from "./mix-hero";
import { useHistory } from "./player/history-store";
import { HomeShelves } from "./home-shelves";
import type { Song, SongsResponse } from "./types";

/**
 * Home — the landing screen, with search now on its own route.
 *
 * They used to be one page: a search field pinned to the top, and shelves
 * underneath for when nothing was typed. That works on a desktop, where the
 * field costs a strip of a wide window. On a phone it meant the first thing the
 * app asked was "what do you want?" — which is the wrong question for someone
 * who opened it to put music on, and it pushed everything worth looking at
 * below a keyboard.
 *
 * So this is the mix and the shelves, and Search is a tab of its own.
 */
export function HomeView() {
  /*
   * The charts start as whatever this browser saw last, not as nothing.
   *
   * A reload used to open on a row of grey placeholder tiles, because the shelf
   * had no data until `/api/charts` answered. It had data all along — an hour
   * old, in `localStorage`, and an hour-old chart is still the chart. See
   * `charts-cache.ts`.
   */
  const cached = useCachedCharts();
  const [fetched, setFetched] = useState<SongsResponse | null>(null);
  const charts = fetched ?? cached;
  const history = useHistory();

  /*
   * Fetched here rather than on the server, and that is deliberate.
   *
   * Moving it to the page looked like the obvious win — no waterfall, the
   * charts in the first paint — and it made things worse. The providers behind
   * this fetch with `cache: "no-store"`, which opts the whole route out of
   * static rendering, so the page went from being served instantly to running
   * two upstream services on every single request.
   *
   * As it stands the markup is static and `/api/charts` carries
   * `s-maxage=3600, stale-while-revalidate=86400`, so the CDN answers this in
   * milliseconds and the shell never waits for anyone.
   */
  useEffect(() => {
    const aborter = new AbortController();
    fetch("/api/charts", { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => {
        if (!data) return;
        setFetched(data);
        // Kept for the next load, so the shelf opens on real songs rather than
        // on placeholders — see `charts-cache.ts`.
        rememberCharts(data);
      })
      .catch(() => {
        // A missing chart is not worth an error message — the rest of the page
        // still works, and the shelves handle their own empty state.
      });
    return () => aborter.abort();
  }, []);

  /*
   * The mix: what you have played, or what is popular if you have played
   * nothing yet.
   *
   * Three entries is the threshold for calling it *yours*. Below that the
   * "built from what you've played" line is a claim about a sample of one, and
   * a mix that is simply the last song you heard is not a mix.
   */
  const personal = history.length >= 3;

  const mix: Song[] = personal
    ? history.slice(0, 20).map((entry) => ({
        id: entry.id,
        title: entry.title,
        artists: entry.artists,
        album: null,
        durationMs: null,
        isrc: null,
        artworkUrl: entry.artworkUrl,
        // History is stored flat rather than as whole songs, so an entry is
        // given the minimum a card needs. Playing one re-resolves it — the
        // same path a Deezer chart entry already takes.
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
      }))
    : (charts?.songs ?? []);

  return (
    <>
      {/*
        The profile button used to sit here, because Home was the only page a
        phone could reach it from. It lives in the shell's top bar now, beside
        the search field, so it is on every page — including the ones somebody
        lands on from a shelf and then wants to change a setting from.
      */}
      <MixHero songs={mix} personal={personal} />
      <HomeShelves charts={charts} />
    </>
  );
}
