"use client";

/**
 * What the chart looked like the last time you saw it.
 *
 * A chart is only interesting if you can see what is *moving*, and movement
 * needs two readings. Timbre has nowhere to keep the first one — no database,
 * no account, nothing about anyone on any server — so the comparison is made
 * against a snapshot in the reader's own browser.
 *
 * That makes the measurement honestly personal, and it is labelled that way
 * wherever it appears: this is movement **since you last looked**, not since
 * yesterday, and two people who opened Explore on different days will correctly
 * see different arrows for the same song.
 *
 * The trade-off is that a first visit has nothing to compare against and shows
 * no arrows at all. That is the right failure: an arrow invented from a single
 * reading would be a number with no meaning behind it.
 */

import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "timbre:chart:";

/**
 * How stale a snapshot must be before it is replaced.
 *
 * Without this, opening Explore twice in a minute would overwrite the reading
 * with an identical one and every arrow would collapse to zero — the feature
 * would quietly delete its own evidence. Twelve hours means a snapshot survives
 * a day's browsing and is refreshed roughly once a day, so the comparison is
 * always against a genuinely earlier chart.
 */
const MIN_AGE_MS = 12 * 60 * 60 * 1000;

export interface ChartSnapshot {
  /** When this reading was taken. */
  at: number;
  /** Song id to the position it held. */
  positions: Record<string, number>;
}

function keyFor(genre: number): string {
  return `${PREFIX}${genre}`;
}

/** The stored reading, or null on a first visit or unreadable storage. */
export function readSnapshot(genre: number): ChartSnapshot | null {
  try {
    const raw = window.localStorage.getItem(keyFor(genre));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ChartSnapshot>;
    if (typeof parsed?.at !== "number" || typeof parsed.positions !== "object") return null;
    return { at: parsed.at, positions: parsed.positions ?? {} };
  } catch {
    // Private browsing, a full quota, or something else's key at this name.
    // Movement is a garnish; nothing here is worth an error path.
    return null;
  }
}

/**
 * Records the current chart, if the stored one has aged out.
 *
 * Returns the snapshot to *compare against* — the previous one when it is still
 * young enough to be worth keeping, and the one just written otherwise. The
 * caller therefore never has to reason about which reading it is holding.
 */
export function rememberChart(
  genre: number,
  tracks: { id: string; position: number }[],
): ChartSnapshot | null {
  const previous = readSnapshot(genre);
  const now = Date.now();

  if (previous && now - previous.at < MIN_AGE_MS) return previous;

  const positions: Record<string, number> = {};
  for (const track of tracks) positions[track.id] = track.position;

  try {
    window.localStorage.setItem(keyFor(genre), JSON.stringify({ at: now, positions }));
  } catch {
    // Out of storage. Playlists and profile pictures matter more than this, so
    // it gives up rather than making room by evicting them.
  }

  return previous;
}

/**
 * The previous reading of a chart, for a component to render against.
 *
 * Shaped as a store subscription rather than an effect that sets state. Reading
 * localStorage *is* reading an external system, and the read has to happen
 * after mount — the server has no storage, so a value derived from it during
 * render is a hydration mismatch waiting for its first visitor. Doing it in
 * `subscribe` puts the work exactly where React expects external reads to
 * happen, and the module cache means it runs once per genre rather than on
 * every render.
 *
 * The server snapshot is `null`, which is also what a first visit sees, so the
 * markup React builds on the server is the markup it finds on the client.
 */
const snapshots = new Map<number, ChartSnapshot | null>();

/**
 * Nothing to compare against, for a list whose order is not a ranking.
 *
 * `null` rather than an unused number, because "no snapshot" and "the snapshot
 * under key N" have to be different things. They were not: a playlist page
 * asked for key `-1` and got whatever the fused ranking had written there, so
 * any track the two lists shared came out wearing an arrow that compared its
 * playlist position to its chart position. Both are integers, so nothing looked
 * wrong — it just said something untrue.
 */
const EMPTY: { id: string; position: number }[] = [];

export function useChartSnapshot(
  /** A genre id, or `null` where movement has no meaning. */
  genre: number | null,
  tracks: { id: string; position: number }[] = EMPTY,
): ChartSnapshot | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (genre !== null && !snapshots.has(genre) && tracks.length > 0) {
        snapshots.set(genre, rememberChart(genre, tracks));
        // Notified on a microtask rather than synchronously: React is still
        // inside its own subscribe call, and telling it the store changed
        // before it has finished wiring up is how a subscription misses its
        // first update.
        queueMicrotask(onChange);
      }
      // Nothing else ever writes this — a snapshot is taken once per genre per
      // page load — so unsubscribing has nothing to tear down.
      return () => {};
    },
    [genre, tracks],
  );

  return useSyncExternalStore(
    subscribe,
    () => (genre === null ? null : (snapshots.get(genre) ?? null)),
    () => null,
  );
}

/**
 * How far a song has climbed since the snapshot.
 *
 * Positive is **up** — a move from 8 to 3 is `+5` — because positions count
 * downward and an arrow that pointed up for a rising number would be read
 * backwards by everyone. `null` means it was not in the previous reading, which
 * is a different statement from "it has not moved" and is shown as *new*.
 */
export function movementOf(
  snapshot: ChartSnapshot | null,
  id: string,
  position: number,
): number | null {
  const before = snapshot?.positions[id];
  return typeof before === "number" ? before - position : null;
}

/** "since yesterday", "since last week" — the age of the reading, in words. */
export function describeAge(at: number): string {
  const days = Math.round((Date.now() - at) / 86_400_000);
  if (days < 1) return "since earlier today";
  if (days === 1) return "since yesterday";
  if (days < 7) return `over ${days} days`;
  if (days < 14) return "over the past week";
  return `over ${Math.round(days / 7)} weeks`;
}
