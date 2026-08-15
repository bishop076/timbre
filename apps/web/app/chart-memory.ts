"use client";

// What the chart looked like the last time you saw it. Movement needs two readings and
// there is no server to keep the first, so this is movement *since you last looked*; a
// first visit has nothing to compare against and shows no arrows.

import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "timbre:chart:";

// Without this, opening Explore twice in a minute overwrites the reading and every arrow
// collapses to zero.
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
    return null;
  }
}

/** Records the chart if the stored one has aged out, returning what to compare against. */
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
    // Gives up rather than evicting playlists or pictures.
  }

  return previous;
}

const snapshots = new Map<number, ChartSnapshot | null>();

const EMPTY: { id: string; position: number }[] = [];

// The previous reading of a chart. A store subscription rather than an effect that sets
// state: the read must happen after mount, since a value derived from storage during render
// is a hydration mismatch. A `null` genre means no snapshot and must stay distinct from a
// real key — a playlist page once passed `-1`, got what the fused ranking had written there,
// and put arrows on shared tracks comparing playlist position to chart position.
export function useChartSnapshot(
  /** A genre id, or `null` where movement has no meaning. */
  genre: number | null,
  tracks: { id: string; position: number }[] = EMPTY,
): ChartSnapshot | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (genre !== null && !snapshots.has(genre) && tracks.length > 0) {
        snapshots.set(genre, rememberChart(genre, tracks));
        // On a microtask: React is still inside its own subscribe call, and telling it the
        // store changed before it finishes wiring up misses the first update.
        queueMicrotask(onChange);
      }
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

/** How far a song has climbed. Positive is up — 8 to 3 is `+5` — since positions count down.
 * `null` means absent from the previous reading, shown as *new*. */
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
