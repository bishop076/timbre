"use client";

import { useEffect, useMemo } from "react";

import { artistKey, tallyGenres, type GenreWeight } from "@/lib/genre-tally";
import type { ArtistTaste, TasteRelease } from "@/lib/taste";

import { createLocalStore, useLocalStore } from "./local-store.ts";
import { useHistory } from "./player/history-store";

interface Known {
  genreId: number | null;
  releases: TasteRelease[];
  at: number;
}

type Book = Record<string, Known>;

const KEY = "timbre:taste";

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

const RECENT = 30;

const PER_VISIT = 6;

const MAX_KNOWN = 300;

const NEW_FOR_MS = 120 * 24 * 60 * 60 * 1000;

const EMPTY: Book = {};

const SEPARATOR = "\n";

function isKnown(value: unknown): value is Known {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Known>;
  return (
    typeof entry.at === "number" &&
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

function read(): Book {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const book: Book = {};
    for (const [name, entry] of Object.entries(parsed)) if (isKnown(entry)) book[name] = entry;
    return book;
  } catch {
    return EMPTY;
  }
}

const store = createLocalStore<Book>({
  read,
  initial: EMPTY,
  write: (next) => window.localStorage.setItem(KEY, JSON.stringify(next)),
  keys: [KEY],
});

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

export interface Taste {
  listening: boolean;
  genres: GenreWeight[];
  genreOf: (artist: string) => number | null;
  releases: TasteRelease[];
  artists: Set<string>;
}

export function useTaste(): Taste {
  const history = useHistory();
  const book = useLocalStore(store);

  const wanted = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const entry of history.slice(0, RECENT)) {
      const artist = entry.artists[0];
      if (!artist) continue;
      const key = artistKey(artist);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(artist);
    }
    return names;
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
