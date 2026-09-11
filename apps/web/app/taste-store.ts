"use client";

import { useEffect, useMemo } from "react";

import { artistKey, tallyGenres } from "@/lib/genre-tally";
import type { ArtistTaste, TasteRelease } from "@/lib/taste";

import { createJsonStore, useLocalStore } from "./local-store.ts";
import { useHistory } from "./player/history-store";

interface Known {
  genreId: number | null;
  releases: TasteRelease[];
  at: number;
}

type Book = Record<string, Known>;

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 7 * DAY_MS;
const NEW_FOR_MS = 120 * DAY_MS;
const RECENT = 30;
const PER_VISIT = 6;
const MAX_KNOWN = 300;
const EMPTY: Book = {};
const SEPARATOR = "\n";

function isKnown(entry: Partial<Known> | null): entry is Known {
  return (
    typeof entry?.at === "number" &&
    (entry.genreId === null || typeof entry.genreId === "number") &&
    Array.isArray(entry.releases) &&
    entry.releases.every(
      (release) =>
        typeof release === "object" &&
        release !== null &&
        typeof release.id === "number" &&
        typeof release.title === "string" &&
        typeof release.artist === "string" &&
        typeof release.kind === "string" &&
        typeof release.date === "string" &&
        (release.coverUrl === null || typeof release.coverUrl === "string"),
    )
  );
}

const store = createJsonStore("timbre:taste", EMPTY, (stored) =>
  Object.fromEntries(Object.entries(stored as Book).filter(([, entry]) => isKnown(entry))),
);

const asking = new Set<string>();

function remember(key: string, known: Known): void {
  const next: Book = { ...store.getSnapshot(), [key]: known };
  const names = Object.keys(next);
  if (names.length > MAX_KNOWN) {
    names
      .sort((a, b) => next[a]!.at - next[b]!.at)
      .slice(0, names.length - MAX_KNOWN)
      .forEach((name) => delete next[name]);
  }
  store.save(next);
}

function unknown(key: string, now: number): boolean {
  const known = store.getSnapshot()[key];
  return !known || now - known.at > STALE_MS;
}

async function learn(artists: string[], signal: AbortSignal): Promise<void> {
  for (const artist of artists) {
    const key = artistKey(artist);
    if (signal.aborted) return;
    if (asking.has(key) || !unknown(key, Date.now())) continue;
    asking.add(key);
    try {
      const response = await fetch(`/api/taste?artist=${encodeURIComponent(artist)}`, { signal });
      if (!response.ok) return;
      const { taste } = (await response.json()) as { taste: ArtistTaste | null };
      remember(key, { genreId: taste?.genreId ?? null, releases: taste?.releases ?? [], at: Date.now() });
    } catch {
      return;
    } finally {
      asking.delete(key);
    }
  }
}

export function useTaste() {
  const history = useHistory();
  const book = useLocalStore(store);

  const wanted = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const entry of history.slice(0, RECENT)) {
      const artist = entry.artists[0] ?? "";
      const key = artistKey(artist);
      if (key && !byKey.has(key)) byKey.set(key, artist);
    }
    return [...byKey.values()];
  }, [history]);

  const wantedKey = wanted.join(SEPARATOR);

  useEffect(() => {
    const now = Date.now();
    const missing = wantedKey
      .split(SEPARATOR)
      .filter((artist) => artist && unknown(artistKey(artist), now))
      .slice(0, PER_VISIT);
    if (missing.length === 0) return;

    const aborter = new AbortController();
    void learn(missing, aborter.signal);
    return () => aborter.abort();
  }, [wantedKey]);

  return useMemo(() => {
    const genreOf = (artist: string) => book[artistKey(artist)]?.genreId ?? null;

    const releases: TasteRelease[] = [];
    const seenRelease = new Set<number>();
    for (const artist of wanted) {
      const known = book[artistKey(artist)];
      if (!known) continue;
      const since = known.at - NEW_FOR_MS;
      for (const release of known.releases) {
        if (seenRelease.has(release.id) || Date.parse(release.date) < since) continue;
        seenRelease.add(release.id);
        releases.push(release);
      }
    }
    releases.sort((a, b) => b.date.localeCompare(a.date));

    return {
      listening: history.length > 0,
      genres: tallyGenres(
        history.slice(0, RECENT).map((entry) => ({ artist: entry.artists[0] })),
        genreOf,
      ),
      genreOf,
      releases,
      artists: new Set(wanted.map(artistKey)),
    };
  }, [book, history, wanted]);
}
