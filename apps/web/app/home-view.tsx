"use client";

import { useEffect, useState } from "react";

import { MixHero } from "./mix-hero";
import { useHistory } from "./player/history-store";
import { HomeShelves } from "./search-results";
import { ProfileButton } from "./shell/sidebar";
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
  const [charts, setCharts] = useState<SongsResponse | null>(null);
  const history = useHistory();

  useEffect(() => {
    const aborter = new AbortController();
    fetch("/api/charts", { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => data && setCharts(data))
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
        Outside <MixHero>, deliberately.

        The hero renders nothing until there is something to play — before the
        charts land, or if they fail entirely. With the button inside it, the
        only route to /profile on a phone would disappear exactly when the
        network is having a bad day, which is when someone is most likely to go
        looking at settings.
      */}
      <div className="mb-4 flex justify-end lg:hidden">
        <ProfileButton />
      </div>

      <MixHero songs={mix} personal={personal} />
      <HomeShelves charts={charts} />
    </>
  );
}
