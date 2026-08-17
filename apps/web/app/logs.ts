"use client";

/**
 * What the sources said, and why playback moved copies. In memory, this tab only — it names
 * uploads and services that refused, which is diagnostic detail nobody asked to have kept,
 * so there is no storage key here and nothing for `clear-storage.ts` to sweep.
 */

import { useSyncExternalStore } from "react";

import { createNotifier } from "./local-store.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** Monotonic within the tab; the React key. */
  id: number;
  at: number;
  level: LogLevel;
  message: string;
}

/** Ring cap, so a session left open all day cannot grow without bound. */
const LIMIT = 100;

/** One array for empty, for ever: `useSyncExternalStore` compares snapshots by identity, and
 * a fresh `[]` per call re-renders until the stack gives out. */
const NONE: readonly LogEntry[] = [];

const notifier = createNotifier();
let entries: readonly LogEntry[] = NONE;
let nextId = 1;

/**
 * Records an entry, oldest first. Deliberately swallows everything: the callers are error
 * paths, and a log that can throw turns a recoverable failure into a broken player.
 */
export function log(level: LogLevel, message: string): void {
  try {
    entries = [...entries, { id: nextId++, at: Date.now(), level, message }].slice(-LIMIT);
    notifier.emit();
  } catch {
    // A listener threw, or the message wasn't a string. Neither is worth propagating.
  }
}

export function clearLogs(): void {
  entries = NONE;
  notifier.emit();
}

/** The entries, oldest first. Stable between writes. */
export function useLogs(): readonly LogEntry[] {
  return useSyncExternalStore(
    notifier.subscribe,
    () => entries,
    () => NONE,
  );
}
