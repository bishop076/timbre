"use client";

import { useEffect, useState } from "react";

import { rememberCharts, useCachedCharts } from "./charts-cache";
import { MixHero } from "./mix-hero";
import { useHistory } from "./player/history-store";
import { HomeShelves } from "./home-shelves";
import type { Song, SongsResponse } from "./types";

/** Home — the mix and the shelves. Search is a route of its own. */
export function HomeView() {
  // Whatever this browser saw last, not grey placeholders. See `charts-cache`.
  const cached = useCachedCharts();
  const [fetched, setFetched] = useState<SongsResponse | null>(null);
  const charts = fetched ?? cached;
  const history = useHistory();

  /*
   * Fetched on the client, not the server: the providers behind this use
   * `cache: "no-store"`, which opts the whole route out of static rendering, so moving
   * the fetch to the page turned an instantly-served shell into two upstream calls on
   * every request.
   */
  useEffect(() => {
    const aborter = new AbortController();
    fetch("/api/charts", { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => {
        if (!data) return;
        setFetched(data);
        rememberCharts(data);
      })
      .catch(() => {
        // A missing chart is not worth an error message.
      });
    return () => aborter.abort();
  }, []);

  // Three entries is the threshold for calling the mix *yours*: below that the
  // "built from what you've played" line is a claim about a sample of one.
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
      <MixHero songs={mix} personal={personal} />
      <HomeShelves charts={charts} />
    </>
  );
}
