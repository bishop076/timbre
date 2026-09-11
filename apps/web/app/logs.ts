"use client";

import { useSyncExternalStore } from "react";

import { createNotifier } from "./local-store.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  message: string;
}

const LIMIT = 100;

const NONE: readonly LogEntry[] = [];

const notifier = createNotifier();
let entries: readonly LogEntry[] = NONE;
let nextId = 1;

export function log(level: LogLevel, message: string): void {
  try {
    entries = [...entries, { id: nextId++, at: Date.now(), level, message }].slice(-LIMIT);
    notifier.emit();
  } catch {
  }
}

export function clearLogs(): void {
  entries = NONE;
  notifier.emit();
}

export function useLogs(): readonly LogEntry[] {
  return useSyncExternalStore(
    notifier.subscribe,
    () => entries,
    () => NONE,
  );
}
