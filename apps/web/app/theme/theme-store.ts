"use client";

import { createLocalStore, useLocalStore } from "../local-store.ts";

export type ThemeMode = "album" | "pastel" | "custom";

export interface ThemeState {
  mode: ThemeMode;
  customHue: number;
  customLight: boolean;
  customNeutral: boolean;
}

const KEY = "timbre:theme";

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

    return {
      mode: isMode(value.mode) ? value.mode : DEFAULT.mode,
      customHue: Number.isFinite(hue) && hue >= 0 && hue < 360 ? Math.round(hue) : DEFAULT.customHue,
      customLight: value.customLight === true,
      customNeutral: value.customNeutral === true,
    };
  } catch {
    return DEFAULT;
  }
}

const store = createLocalStore<ThemeState>({
  read,
  initial: DEFAULT,
  write: (next) => window.localStorage.setItem(KEY, JSON.stringify(next)),
  keys: [KEY],
});

export const getThemeSnapshot = store.getSnapshot;

export function useTheme(): ThemeState {
  return useLocalStore(store);
}

export function setThemeMode(mode: ThemeMode): void {
  store.save({ ...getThemeSnapshot(), mode });
}

export function setCustomHue(hue: number): void {
  const wrapped = ((Math.round(hue) % 360) + 360) % 360;
  store.save({ ...getThemeSnapshot(), customHue: wrapped, customNeutral: false, mode: "custom" });
}

export function setCustomLight(light: boolean): void {
  store.save({ ...getThemeSnapshot(), customLight: light, mode: "custom" });
}

export function setNeutral(light: boolean): void {
  store.save({ ...getThemeSnapshot(), customNeutral: true, customLight: light, mode: "custom" });
}

export function isLightTheme(theme: ThemeState): boolean {
  if (theme.mode === "pastel") return true;
  if (theme.mode === "custom") return theme.customLight;
  return false;
}
