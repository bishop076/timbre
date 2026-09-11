"use client";

import { useEffect, useRef } from "react";

import { sampleHue } from "../hue";
import { buildPalette, type Palette, type Swatch } from "../theme/palette";
import { getThemeSnapshot, isLightTheme, useTheme, type ThemeState } from "../theme/theme-store";

const SWATCH_KEY = "timbre:swatch";

function rememberSwatch(swatch: Swatch): void {
  try {
    window.localStorage.setItem(SWATCH_KEY, JSON.stringify(swatch));
  } catch {
  }
}

function lastSwatch(): Swatch | null {
  try {
    const raw = window.localStorage.getItem(SWATCH_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    const { hue, sat } = (parsed ?? {}) as Partial<Swatch>;
    return Number.isFinite(hue) && Number.isFinite(sat)
      ? { hue: hue as number, sat: sat as number }
      : null;
  } catch {
    return null;
  }
}

const PALETTE_KEY = "timbre:palette";

function rememberPalette(palette: Palette, theme: ThemeState): void {
  try {
    window.localStorage.setItem(
      PALETTE_KEY,
      JSON.stringify({
        vars: palette,
        theme: isLightTheme(theme) ? "light" : "dark",
        mode: theme.mode,
        neutral: theme.mode === "custom" && theme.customNeutral,
      }),
    );
  } catch {
  }
}

function apply(swatch: Swatch | null, theme: ThemeState): void {
  const root = document.documentElement;
  const palette = buildPalette(swatch, theme);

  if (swatch) rememberSwatch(swatch);
  rememberPalette(palette, theme);

  for (const [token, value] of Object.entries(palette)) {
    root.style.setProperty(token, value);
  }
  root.dataset.theme = isLightTheme(theme) ? "light" : "dark";
  root.dataset.mode = theme.mode;
  root.dataset.neutral = String(theme.mode === "custom" && theme.customNeutral);
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  const subscribed = useTheme();
  const themeKey = `${subscribed.mode}:${subscribed.customHue}:${subscribed.customLight}:${subscribed.customNeutral}`;

  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const theme = getThemeSnapshot();

    if (theme.mode === "custom") {
      lastUrl.current = null;
      document.documentElement.style.setProperty(
        "--artwork-img",
        artworkUrl ? `url("/api/art?u=${encodeURIComponent(artworkUrl)}")` : "none",
      );
      apply(null, theme);
      return;
    }

    if (!artworkUrl) {
      lastUrl.current = null;
      document.documentElement.style.setProperty("--artwork-img", "none");
      apply(lastSwatch(), theme);
      return;
    }
    if (lastUrl.current === `${theme.mode}:${artworkUrl}`) return;
    lastUrl.current = `${theme.mode}:${artworkUrl}`;

    document.documentElement.style.setProperty(
      "--artwork-img",
      `url("/api/art?u=${encodeURIComponent(artworkUrl)}")`,
    );

    return sampleHue(`/api/art?u=${encodeURIComponent(artworkUrl)}`, (found) => {
      apply(found && { hue: found.h * 360, sat: found.s }, theme);
    });
  }, [artworkUrl, themeKey]);
}
