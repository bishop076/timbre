"use client";

import { useCallback, useSyncExternalStore } from "react";

import { readJson, writeJson } from "./local-store.ts";

const MIN_AGE_MS = 12 * 60 * 60 * 1000;

interface ChartSnapshot {
  at: number;
  positions: Record<string, number>;
}

type Placed = { id: string; position: number };

function rememberChart(genre: number, tracks: Placed[]): ChartSnapshot | null {
  const key = `timbre:chart:${genre}`;
  const stored = readJson(key) as Partial<ChartSnapshot> | null;
  const previous =
    typeof stored?.at === "number" && typeof stored.positions === "object"
      ? { at: stored.at, positions: stored.positions ?? {} }
      : null;
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
