"use client";

import { createLocalStore, useLocalStore } from "./local-store.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  /** When it last happened — see `count`. */
  at: number;
  level: LogLevel;
  /** The line as written, with no repeat marker. What the next call compares itself against. */
  text: string;
  /** What the panel prints: `text`, plus a ×N once the same line has arrived more than once. */
  message: string;
  /** How many times in a row this line has arrived. 1 for everything that is not a loop. */
  count: number;
}

/**
 * Two ceilings, and they are separate on purpose.
 *
 * `LIMIT` was here already and bounds the number of entries. `MAX_TEXT` is new and bounds each
 * one: nothing writing to this log promises a short string — `spotify-sdk-player.tsx` slices a
 * response body by hand, and the next caller to forget would have put an upstream's entire HTML
 * error page into a panel that has to stay skimmable. 100 × 300 characters is the worst case
 * this store can occupy, and it is now an actual worst case rather than an expectation.
 */
const LIMIT = 100;
const MAX_TEXT = 300;

const NONE: readonly LogEntry[] = [];
const store = createLocalStore({ initial: NONE });
let nextId = 1;

function trim(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
}

/**
 * The thing that made this log hard to read was never one bad line, it was a hundred good ones:
 * a player retrying a blocked video, or a source refusing every request in a search, writes the
 * same sentence until it has pushed everything that led up to it off the end. So an identical
 * line arriving straight after itself updates the entry in place and counts, rather than taking
 * a slot — which means the buffer now holds a hundred *distinct* events, and the loop is visible
 * as a loop instead of as wallpaper.
 *
 * `at` follows the most recent occurrence, not the first. The reader's question in front of a
 * repeating failure is "is this still happening", and a timestamp frozen at the first attempt
 * answers a question nobody asked.
 */
export function log(level: LogLevel, message: string): void {
  try {
    const text = trim(message);
    if (!text) return;

    const entries = store.getSnapshot();
    const previous = entries.at(-1);

    if (previous && previous.level === level && previous.text === text) {
      const count = previous.count + 1;
      store.publish([
        ...entries.slice(0, -1),
        { ...previous, at: Date.now(), count, message: `${text} ×${count}` },
      ]);
      return;
    }

    const entry: LogEntry = {
      id: nextId++,
      at: Date.now(),
      level,
      text,
      message: text,
      count: 1,
    };
    store.publish([...entries, entry].slice(-LIMIT));
  } catch {}
}

export function clearLogs(): void {
  store.publish(NONE);
}

/** The same list `useLogs` renders, for anything that wants it once rather than on every change. */
export function readLogs(): readonly LogEntry[] {
  return store.getSnapshot();
}

export function useLogs(): readonly LogEntry[] {
  return useLocalStore(store);
}
