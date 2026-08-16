"use client";

import { createLocalStore, useLocalStore } from "../local-store.ts";

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

const store = createLocalStore<ThemeState>({
  read,
  initial: DEFAULT,
  write: (next) => window.localStorage.setItem(KEY, JSON.stringify(next)),
  keys: [KEY],
});

/** The current theme. Lazy for the server, cached after — `getSnapshot` needs a stable object. */
export const getThemeSnapshot = store.getSnapshot;

export function useTheme(): ThemeState {
  return useLocalStore(store);
}

export function setThemeMode(mode: ThemeMode): void {
  store.save({ ...getThemeSnapshot(), mode });
}

export function setCustomHue(hue: number): void {
  const wrapped = ((Math.round(hue) % 360) + 360) % 360;
  // Also chooses the mode and leaves neutral, or the swatch changes nothing visible.
  store.save({ ...getThemeSnapshot(), customHue: wrapped, customNeutral: false, mode: "custom" });
}

export function setCustomLight(light: boolean): void {
  store.save({ ...getThemeSnapshot(), customLight: light, mode: "custom" });
}

/** Plain white or plain dark, no tint. Sets the ground too — "white" already names both. */
export function setNeutral(light: boolean): void {
  store.save({ ...getThemeSnapshot(), customNeutral: true, customLight: light, mode: "custom" });
}

/** Whether a mode paints on a light ground — the single answer, so builder, attribute and wash agree. */
export function isLightTheme(theme: ThemeState): boolean {
  if (theme.mode === "pastel") return true;
  if (theme.mode === "custom") return theme.customLight;
  return false;
}
