"use client";

import { createLocalStore, useLocalStore } from "./local-store.ts";

export type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  message: string;
}

const LIMIT = 100;
const NONE: readonly LogEntry[] = [];
const store = createLocalStore({ initial: NONE });
let nextId = 1;

export function log(level: LogLevel, message: string): void {
  try {
    const entry = { id: nextId++, at: Date.now(), level, message };
    store.publish([...store.getSnapshot(), entry].slice(-LIMIT));
  } catch {}
}

export function clearLogs(): void {
  store.publish(NONE);
}

export function useLogs(): readonly LogEntry[] {
  return useLocalStore(store);
}
