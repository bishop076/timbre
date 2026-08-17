"use client";

import { useEffect, useRef } from "react";

import { sampleHue } from "../hue";
import { buildPalette, type Palette, type Swatch } from "../theme/palette";
import { getThemeSnapshot, isLightTheme, useTheme, type ThemeState } from "../theme/theme-store";

// Recolours the app from the current track's artwork — `../hue` finds the colour, this
// turns it into a palette and writes it on the document root.

// The last colour the app wore. With nothing playing there is no artwork to sample, so
// every refresh reset the interface to the default purple until something was played.
const SWATCH_KEY = "timbre:swatch";

function rememberSwatch(swatch: Swatch): void {
  try {
    window.localStorage.setItem(SWATCH_KEY, JSON.stringify(swatch));
  } catch {
    // Private browsing or a full quota.
  }
}

function lastSwatch(): Swatch | null {
  try {
    const raw = window.localStorage.getItem(SWATCH_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    const { hue, sat } = (parsed ?? {}) as Partial<Swatch>;
    // Shape-checked: a `NaN` hue would produce `hsl(NaN …)` on every surface at once.
    return Number.isFinite(hue) && Number.isFinite(sat)
      ? { hue: hue as number, sat: sat as number }
      : null;
  } catch {
    return null;
  }
}

// The last palette painted, replayed before the next first paint — the blocking script can
// only set the ground, so the first paint used the static fallback ramp and the real one
// arrived on hydration: the black-then-purple flash. The *output* is cached, not the
// inputs, since a second `buildPalette` in the inline script would drift.
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
    // Quota or private browsing.
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
  // Mode as well as ground: pastel needs a quieter backdrop than a custom light.
  root.dataset.mode = theme.mode;
  // Neutral suppresses the blurred-cover backdrop — see globals.css.
  root.dataset.neutral = String(theme.mode === "custom" && theme.customNeutral);
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  // Subscribed for re-runs; the value itself is read live inside the effect.
  const subscribed = useTheme();
  const themeKey = `${subscribed.mode}:${subscribed.customHue}:${subscribed.customLight}:${subscribed.customNeutral}`;

  // Avoids re-reading the same image on an unrelated re-render; position ticks 2Hz.
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    // Read live, not from the render. `useTheme()` returns the server default during
    // hydration, and this effect's first run is on that commit, so `apply()` overwrote the
    // `data-theme` the blocking script had stamped — turning the whole app black for a
    // moment on every load. `getThemeSnapshot()` reads storage on its first client call.
    const theme = getThemeSnapshot();

    // A fixed theme never samples. The backdrop is still set — that is the cover itself.
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
      // The colour the last cover gave it, not the default purple — see `lastSwatch`.
      apply(lastSwatch(), theme);
      return;
    }
    // Keyed on theme too: switching mode mid-song repaints, and the URL has not changed.
    if (lastUrl.current === `${theme.mode}:${artworkUrl}`) return;
    lastUrl.current = `${theme.mode}:${artworkUrl}`;

    document.documentElement.style.setProperty(
      "--artwork-img",
      `url("/api/art?u=${encodeURIComponent(artworkUrl)}")`,
    );

    // Through `/api/art`, not the CDN: content blockers filter by hostname and
    // `i.ytimg.com` is on enough lists that the image never loads for anyone running one,
    // so the app silently falls back to purple on every song. A first-party request matches
    // no blocklist and cannot taint the canvas. The returned cancel is the cleanup, so a
    // decode in flight from the previous track cannot land after the track has changed.
    return sampleHue(`/api/art?u=${encodeURIComponent(artworkUrl)}`, (found) => {
      apply(found && { hue: found.h * 360, sat: found.s }, theme);
    });
    // `themeKey`, not the theme object: the store hands out a fresh object per write.
  }, [artworkUrl, themeKey]);
}
