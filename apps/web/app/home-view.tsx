"use client";

import { useEffect, useState } from "react";

import { rememberCharts, useCachedCharts } from "./charts-cache";
import { MixHero } from "./mix-hero";
import { useHistory } from "./player/history-store";
import { HomeShelves, songFromHistory } from "./home-shelves";
import type { Song, SongsResponse } from "./types";

/** Home — the mix and the shelves. Search is a route of its own. */
export function HomeView() {
  // Whatever this browser saw last, not grey placeholders. See `charts-cache`.
  const cached = useCachedCharts();
  const [fetched, setFetched] = useState<SongsResponse | null>(null);
  /*
   * Told apart from "still loading", which it was not.
   *
   * A refused or unreachable /api/charts left `fetched` null for ever, and null is what
   * the shelves render eight pulsing skeletons for — so a 429 or an offline first visit
   * showed "Trending now" over placeholders that never resolved. The sentence saying
   * search still works was already written and could not be reached.
   */
  const [failed, setFailed] = useState(false);
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
        if (!data) {
          setFailed(true);
          return;
        }
        setFetched(data);
        rememberCharts(data);
      })
      .catch((cause: unknown) => {
        // An abort is this component unmounting, not a failure to report.
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setFailed(true);
      });
    return () => aborter.abort();
  }, []);

  // Three entries is the threshold for calling the mix *yours*: below that the
  // "built from what you've played" line is a claim about a sample of one.
  const personal = history.length >= 3;

  const mix: Song[] = personal
    ? history.slice(0, 20).map(songFromHistory)
    : (charts?.songs ?? []);

  return (
    <>
      <MixHero songs={mix} personal={personal} />
      <HomeShelves charts={charts} failed={failed && charts === null} />
    </>
  );
}
