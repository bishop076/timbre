"use client";

import { useCallback, useSyncExternalStore } from "react";

import { readJson, writeJson } from "./local-store.ts";
import { playedAt } from "./stats/play-log.ts";

const MIN_AGE_MS = 12 * 60 * 60 * 1000;

interface ChartSnapshot {
  at: number;
  positions: Record<string, number>;
}

type Placed = { id: string; position: number };

/**
 * A snapshot this browser wrote, or nothing.
 *
 * `typeof stored.at === "number"` let `1e20` through, and `at` is printed: `describeAge` turns
 * it into "over 3170979198376 weeks" under the movement arrows, in a sentence that is meant to
 * say when the reader last looked. It is also the clock this store runs on — `now - at` decides
 * whether today's positions replace yesterday's — so a time no `Date` can represent freezes the
 * comparison as well as reading absurdly. `playedAt` is the rule the play log and the taste book
 * apply to a stored time; there is no reason for a third.
 *
 * A position has to be a real number for the same reason, and `Object.entries` of a stored array
 * would otherwise have made every index a track id.
 */
export function readSnapshot(stored: unknown): ChartSnapshot | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
  const { at, positions } = stored as { at?: unknown; positions?: unknown };
  const when = playedAt(at);
  if (when === null) return null;
  if (typeof positions !== "object" || positions === null || Array.isArray(positions)) return null;

  const placed = Object.entries(positions).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return { at: when, positions: Object.fromEntries(placed) };
}

function rememberChart(genre: number, tracks: Placed[]): ChartSnapshot | null {
  const key = `timbre:chart:${genre}`;
  const previous = readSnapshot(readJson(key));
  const now = Date.now();
  if (previous && now - previous.at < MIN_AGE_MS) return previous;

  const positions = Object.fromEntries(tracks.map((track) => [track.id, track.position]));
  writeJson(key, { at: now, positions });
  return previous;
}

const snapshots = new Map<number, ChartSnapshot | null>();

export function useChartSnapshot(genre: number | null, tracks: Placed[]): ChartSnapshot | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (genre !== null && !snapshots.has(genre) && tracks.length > 0) {
        snapshots.set(genre, rememberChart(genre, tracks));
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

export function movementOf(
  snapshot: ChartSnapshot | null,
  id: string,
  position: number,
): number | null {
  const before = snapshot?.positions[id];
  return typeof before === "number" ? before - position : null;
}

export function describeAge(at: number): string {
  const days = Math.round((Date.now() - at) / 86_400_000);
  if (days < 1) return "since earlier today";
  if (days === 1) return "since yesterday";
  if (days < 7) return `over ${days} days`;
  if (days < 14) return "over the past week";
  return `over ${Math.round(days / 7)} weeks`;
}
