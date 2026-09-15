"use client";

import { useEffect, useMemo } from "react";

import { artistKey, tallyGenres } from "@/lib/genre-tally";
import type { ArtistTaste, TasteRelease } from "@/lib/taste";

import { createJsonStore, useLocalStore } from "./local-store.ts";
import { useHistory } from "./player/history-store";
import { playedAt } from "./stats/play-log.ts";

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
const MAX_RELEASES = 12;
const EMPTY: Book = {};
const SEPARATOR = "\n";

/**
 * `at` is a lookup time, and the play log already says what one of those is.
 *
 * `typeof entry.at === "number"` was the whole check, and `NaN` passes it. One of those did
 * three things at once: `now - at > STALE_MS` is false, so that artist is never looked up again
 * for as long as the book lives; `at - NEW_FOR_MS` makes every release comparison false, so the
 * artist's whole back catalogue reads as new; and `newest()` sorts on `b.at - a.at`, where a
 * `NaN` comparator result is undefined behaviour in the spec — the trim then drops whichever
 * 100 entries the engine's sort happens to land on, taking real lookups with it. Out-of-range
 * times are the same story. `playedAt` is the rule the play log applies to a stored time, and
 * two stores describing the same kind of value with different validators is how the weaker one
 * ends up deciding.
 */
function isKnown(entry: Partial<Known> | null): entry is Known {
  if (!entry || playedAt(entry.at) === null) return false;

  return (
    // A genre is an id from Deezer, so a whole number: `NaN` is a `number` to `typeof`, and it
    // would go on to key the tally and the `genreOf` lookup that every shelf is built from.
    (entry.genreId === null || Number.isInteger(entry.genreId)) &&
    Array.isArray(entry.releases) &&
    // `fetchArtistTaste` slices to three, so a book holding dozens against one name was not
    // written by this app; `useTaste` walks every one of them on every render.
    entry.releases.length <= MAX_RELEASES &&
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

/**
 * The newest `MAX_KNOWN` artists and no more — the same rule on both sides of storage.
 *
 * `remember` trimmed on the way out and the read took whatever it found, so a book written by
 * a build with a larger cap, merged by a second tab, or edited by hand came back at its full
 * length and stayed there: nothing trims on read, and `remember` only ever removes the excess
 * *one write* creates, so 400 entries went back out as 400. A bound only the writer honours is
 * not a bound. `at` is when the artist was last looked up, so the oldest lookups go first.
 */
function newest(book: Book): Book {
  const names = Object.keys(book);
  if (names.length <= MAX_KNOWN) return book;

  return Object.fromEntries(
    names
      .sort((a, b) => book[b]!.at - book[a]!.at)
      .slice(0, MAX_KNOWN)
      .map((name) => [name, book[name]!]),
  );
}

/** What this browser has stored, held to the shape and the size the app writes. */
export function readBook(stored: unknown): Book {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return EMPTY;
  return newest(
    Object.fromEntries(
      Object.entries(stored as Record<string, Partial<Known> | null>).filter(([, entry]) =>
        isKnown(entry),
      ),
    ) as Book,
  );
}

const store = createJsonStore("timbre:taste", EMPTY, readBook);

const asking = new Set<string>();

function remember(key: string, known: Known): void {
  store.save(newest({ ...store.getSnapshot(), [key]: known }));
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
