"use client";

import { useEffect, useState } from "react";

import { rememberCharts, useCachedCharts } from "./charts-cache";
import { MixHero } from "./mix-hero";
import { useHistory } from "./player/history-store";
import { HomeShelves, songFromHistory } from "./home-shelves";
import type { Song, SongsResponse } from "./types";

export function HomeView() {
  const cached = useCachedCharts();
  const [fetched, setFetched] = useState<SongsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const charts = fetched ?? cached;
  const history = useHistory();

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
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setFailed(true);
      });
    return () => aborter.abort();
  }, []);

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
