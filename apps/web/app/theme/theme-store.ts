"use client";

import { createJsonStore, useLocalStore } from "../local-store.ts";

export type ThemeMode = "album" | "pastel" | "custom";

export interface ThemeState {
  mode: ThemeMode;
  customHue: number;
  customLight: boolean;
  customNeutral: boolean;
}

const DEFAULT: ThemeState = {
  mode: "album",
  customHue: 258,
  customLight: false,
  customNeutral: false,
};

const store = createJsonStore("timbre:theme", DEFAULT, (stored) => {
  const value = stored as Partial<ThemeState>;
  const hue = Number(value.customHue);
  return {
    mode: value.mode === "pastel" || value.mode === "custom" ? value.mode : DEFAULT.mode,
    customHue: Number.isFinite(hue) && hue >= 0 && hue < 360 ? Math.round(hue) : DEFAULT.customHue,
    customLight: value.customLight === true,
    customNeutral: value.customNeutral === true,
  };
});

export const getThemeSnapshot = store.getSnapshot;

export function useTheme(): ThemeState {
  return useLocalStore(store);
}

function update(patch: Partial<ThemeState>): void {
  store.save({ ...getThemeSnapshot(), ...patch });
}

export const setThemeMode = (mode: ThemeMode) => update({ mode });

export const setCustomHue = (hue: number) =>
  update({ customHue: ((Math.round(hue) % 360) + 360) % 360, customNeutral: false, mode: "custom" });

export const setCustomLight = (customLight: boolean) => update({ customLight, mode: "custom" });

export const setNeutral = (customLight: boolean) =>
  update({ customNeutral: true, customLight, mode: "custom" });

export function isLightTheme(theme: ThemeState): boolean {
  return theme.mode === "pastel" || (theme.mode === "custom" && theme.customLight);
}
