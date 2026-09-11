"use client";

import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "timbre:chart:";

const MIN_AGE_MS = 12 * 60 * 60 * 1000;

export interface ChartSnapshot {
  at: number;
  positions: Record<string, number>;
}

function keyFor(genre: number): string {
  return `${PREFIX}${genre}`;
}

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
  }

  return previous;
}

const snapshots = new Map<number, ChartSnapshot | null>();

const EMPTY: { id: string; position: number }[] = [];

export function useChartSnapshot(
  genre: number | null,
  tracks: { id: string; position: number }[] = EMPTY,
): ChartSnapshot | null {
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
