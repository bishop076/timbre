"use client";

import { useSyncExternalStore } from "react";

/*
 * Which palette the app wears. Lives in `localStorage`, so outside React and unreadable by
 * the server; `useSyncExternalStore` renders the default and then re-reads the real value.
 */

/** `album` ramps from the cover on dark, `pastel` inverts that onto light, `custom` is one fixed hue. */
export type ThemeMode = "album" | "pastel" | "custom";

export interface ThemeState {
  mode: ThemeMode;
  /** Hue in degrees, 0–359. Only consulted in `custom`, and ignored when neutral. */
  customHue: number;
  customLight: boolean;
  /**
   * No hue at all. A separate flag, not a saturation of zero, which would be
   * indistinguishable from a picked colour and undone the moment a swatch was touched.
   */
  customNeutral: boolean;
}

const KEY = "timbre:theme";

/** Referentially stable, and what hydration renders against. */
const DEFAULT: ThemeState = {
  mode: "album",
  customHue: 258,
  customLight: false,
  customNeutral: false,
};

let snapshot: ThemeState = DEFAULT;
let loaded = false;

const listeners = new Set<() => void>();

function isMode(value: unknown): value is ThemeMode {
  return value === "album" || value === "pastel" || value === "custom";
}

function read(): ThemeState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT;

    const value = parsed as Partial<ThemeState>;
    const hue = Number(value.customHue);

    // Field by field: user-editable storage, so a half-valid record degrades per field.
    return {
      mode: isMode(value.mode) ? value.mode : DEFAULT.mode,
      customHue: Number.isFinite(hue) && hue >= 0 && hue < 360 ? Math.round(hue) : DEFAULT.customHue,
      customLight: value.customLight === true,
      customNeutral: value.customNeutral === true,
    };
  } catch {
    // Private browsing throws rather than returning null; so does malformed JSON.
    return DEFAULT;
  }
}

function write(next: ThemeState): void {
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
  }
  for (const listener of listeners) listener();
}

/** Another tab changed the theme; follow it rather than diverging. */
function onStorage(event: StorageEvent): void {
  if (event.key !== KEY) return;
  snapshot = read();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** The current theme. Lazy for the server, cached after — `getSnapshot` needs a stable object. */
export function getThemeSnapshot(): ThemeState {
  if (!loaded) {
    loaded = true;
    snapshot = read();
  }
  return snapshot;
}

function getServerSnapshot(): ThemeState {
  return DEFAULT;
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);
}

export function setThemeMode(mode: ThemeMode): void {
  write({ ...getThemeSnapshot(), mode });
}

export function setCustomHue(hue: number): void {
  const wrapped = ((Math.round(hue) % 360) + 360) % 360;
  // Also chooses the mode and leaves neutral, or the swatch changes nothing visible.
  write({ ...getThemeSnapshot(), customHue: wrapped, customNeutral: false, mode: "custom" });
}

export function setCustomLight(light: boolean): void {
  write({ ...getThemeSnapshot(), customLight: light, mode: "custom" });
}

/** Plain white or plain dark, no tint. Sets the ground too — "white" already names both. */
export function setNeutral(light: boolean): void {
  write({ ...getThemeSnapshot(), customNeutral: true, customLight: light, mode: "custom" });
}

/** Whether a mode paints on a light ground — the single answer, so builder, attribute and wash agree. */
export function isLightTheme(theme: ThemeState): boolean {
  if (theme.mode === "pastel") return true;
  if (theme.mode === "custom") return theme.customLight;
  return false;
}
