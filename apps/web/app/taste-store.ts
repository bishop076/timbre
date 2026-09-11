"use client";

/**
 * Which genres this browser listens to, for Explore to lead with. Built from the history
 * (`player/history-store.ts`) plus one fact per artist — their Deezer genre and newest
 * releases — asked of `/api/taste` a name at a time and remembered here, so each artist is
 * looked up about once a week however often Explore is opened. Stored beside the history and
 * nowhere else; clearing site data clears it with everything else.
 */

import { useEffect, useMemo } from "react";

import { artistKey, tallyGenres, type GenreWeight } from "@/lib/genre-tally";
import type { ArtistTaste, TasteRelease } from "@/lib/taste";

import { createLocalStore, useLocalStore } from "./local-store.ts";
import { useHistory } from "./player/history-store";

interface Known {
  genreId: number | null;
  releases: TasteRelease[];
  /** When it was asked, for staleness — and the reference "recent" is measured from. */
  at: number;
}

type Book = Record<string, Known>;

const KEY = "timbre:taste";

/** A week: genres do not change, releases do, and a week is a release cycle. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** How far back of the history votes. More than the shelves need, fewer than the 50 kept. */
const RECENT = 30;

/**
 * Lookups one visit may start. A first visit with a long history would otherwise send thirty
 * requests at once, against a per-client limit of sixty a minute that search shares. The rest
 * are learnt on later visits — the newest plays first, which are the ones that weigh most.
 */
const PER_VISIT = 6;

/** Names remembered at most. Beyond it the longest-unasked go first. */
const MAX_KNOWN = 300;

/** A release counts as new for four months after it came out. */
const NEW_FOR_MS = 120 * 24 * 60 * 60 * 1000;

const EMPTY: Book = {};

/** Joins the wanted names into one dependency. A newline, because names contain spaces. */
const SEPARATOR = "\n";

function isKnown(value: unknown): value is Known {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Known>;
  return (
    typeof entry.at === "number" &&
    (entry.genreId === null || typeof entry.genreId === "number") &&
    Array.isArray(entry.releases) &&
    // Each release, not only the list — `releases: [null]` threw in Explore (S-11).
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
    // A bad row drops itself: stored data outlives the code that wrote it.
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

/** Names being asked right now, across every component using this — Explore mounts several. */
const asking = new Set<string>();

/** Writes one answer, trimming the book to `MAX_KNOWN` by age. */
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

/** Whether an artist needs asking about — never asked, or asked more than a week ago. */
function unknown(key: string, now: number): boolean {
  const known = store.getSnapshot()[key];
  return !known || now - known.at > STALE_MS;
}

/**
 * Asks for each artist in turn — one at a time, since nothing is waiting on the order. Every
 * component using the taste runs this, so each name is re-checked as it comes up: another
 * caller's loop may have asked it, or be asking it, in the meantime.
 */
async function learn(artists: string[], signal: AbortSignal): Promise<void> {
  for (const artist of artists) {
    const key = artistKey(artist);
    if (signal.aborted) return;
    if (asking.has(key) || !unknown(key, Date.now())) continue;
    asking.add(key);
    try {
      const response = await fetch(`/api/taste?artist=${encodeURIComponent(artist)}`, { signal });
      // Refused or failing: stop for this visit rather than spend the budget search needs.
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
  /** Anything played at all — as opposed to played, but not understood yet. */
  listening: boolean;
  /** Heaviest first. Empty until an artist has been looked up. */
  genres: GenreWeight[];
  /** An artist's genre, if it has been learnt. */
  genreOf: (artist: string) => number | null;
  /** Everything the history's artists put out in the last few months, newest first. */
  releases: TasteRelease[];
  /** Every lead artist in the history, loosely normalised — for "you play them". */
  artists: Set<string>;
}

/** Subscribes to the taste, and quietly fills in artists it has not met. Client-only. */
export function useTaste(): Taste {
  const history = useHistory();
  const book = useLocalStore(store);

  // Missing or stale, newest plays first. Keyed on a string so the effect below runs when the
  // set of names changes rather than on every render of a fresh array.
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
      // Measured from when it was asked, not from now: reading the clock here would make
      // this render impure, and the answer is never more than a week old.
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
