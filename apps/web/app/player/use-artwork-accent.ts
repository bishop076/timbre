"use client";

import { useEffect, useRef } from "react";

import { sampleHue } from "../hue";
import { buildPalette, type Swatch } from "../theme/palette";
import { getThemeSnapshot, isLightTheme, useTheme, type ThemeState } from "../theme/theme-store";

const SWATCH_KEY = "timbre:swatch";
const PALETTE_KEY = "timbre:palette";

function store(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function lastSwatch(): Swatch | null {
  try {
    const saved = window.localStorage.getItem(SWATCH_KEY) || "{}";
    const { hue, sat } = JSON.parse(saved) as Partial<Swatch>;
    return Number.isFinite(hue) && Number.isFinite(sat) ? { hue: hue!, sat: sat! } : null;
  } catch {
    return null;
  }
}

function apply(swatch: Swatch | null, theme: ThemeState): void {
  const root = document.documentElement;
  const vars = buildPalette(swatch, theme);
  const ground = isLightTheme(theme) ? "light" : "dark";
  const neutral = theme.mode === "custom" && theme.customNeutral;

  if (swatch) store(SWATCH_KEY, swatch);
  store(PALETTE_KEY, { vars, theme: ground, mode: theme.mode, neutral });

  for (const [token, value] of Object.entries(vars)) root.style.setProperty(token, value);
  root.dataset.theme = ground;
  root.dataset.mode = theme.mode;
  root.dataset.neutral = String(neutral);
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  const subscribed = useTheme();
  const themeKey = `${subscribed.mode}:${subscribed.customHue}:${subscribed.customLight}:${subscribed.customNeutral}`;
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const theme = getThemeSnapshot();
    const art = artworkUrl ? `/api/art?u=${encodeURIComponent(artworkUrl)}` : null;
    const { style } = document.documentElement;

    if (theme.mode === "custom" || !art) {
      lastUrl.current = null;
      style.setProperty("--artwork-img", art ? `url("${art}")` : "none");
      apply(theme.mode === "custom" ? null : lastSwatch(), theme);
      return;
    }
    if (lastUrl.current === `${theme.mode}:${artworkUrl}`) return;
    lastUrl.current = `${theme.mode}:${artworkUrl}`;

    style.setProperty("--artwork-img", `url("${art}")`);
    // A read that fails — a host the proxy refuses, a rate-limited fetch, a decode error —
    // reports null, and null repaints everything the default violet. Hold the last swatch
    // instead: a stale accent beats the app flashing back to its factory colour.
    return sampleHue(art, (found) =>
      apply(found ? { hue: found.h * 360, sat: found.s } : lastSwatch(), theme),
    );
  }, [artworkUrl, themeKey]);
}
