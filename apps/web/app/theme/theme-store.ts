"use client";

/**
 * The one place a theme choice is held, validated and written back.
 *
 * What is stored is a *seed and a handful of switches*, not a template: one colour, the ground
 * it sits on, where the colour comes from, and the accessibility knobs. `custom-theme.ts`
 * derives everything else from that, including the legacy four fields the existing ramp still
 * reads — they are recomputed on every write and on every read, so nothing downstream had to
 * change on the day this landed.
 */

import { useSyncExternalStore } from "react";

import { createLocalStore, readJson, useLocalStore, writeJson } from "../local-store.ts";
import { applyBackgroundPrefs, paint as paintBackground } from "./background.ts";
import {
  artworkSeed,
  DEFAULT_THEME,
  msToNextStep,
  parseTheme,
  resolveGround,
  seedAt,
  themeVars,
  withMirror,
  type AccentSource,
  type BackgroundPrefs,
  type Contrast,
  type Ground,
  type Theme,
  type ThemeState,
} from "./custom-theme.ts";
import { applyFont, type FontId } from "./fonts.ts";
import {
  prefersDark,
  prefersReducedMotion,
  setFlag,
  setTextScale,
  setVars,
} from "./theme-css.ts";

export const THEME_KEY = "timbre:theme";

export type { Theme, ThemeState } from "./custom-theme.ts";

const store = createLocalStore<Theme>({
  initial: DEFAULT_THEME,
  read: () => withMirror(parseTheme(readJson(THEME_KEY)), prefersDark()),
  write: (value) => writeJson(THEME_KEY, value),
  keys: [THEME_KEY],
  onFirstRead: (value) => {
    // Deferred: the first read happens inside a render, and everything below writes to the
    // document. The pre-paint script has already painted what it could, so a microtask of
    // delay is invisible.
    if (typeof window !== "undefined") queueMicrotask(() => start(value));
  },
});

export const getThemeSnapshot = store.getSnapshot;

export function useTheme(): Theme {
  return useLocalStore(store);
}

/* ------------------------------------------------------------------ the live seed */

/** What the last cover sampled to, as `use-artwork-accent.ts` stored it. */
const SWATCH_KEY = "timbre:swatch";

let liveSeed = DEFAULT_THEME.accent;

/**
 * The colour *right now* — which is not always the stored one. It drifts on a timer in "cycle",
 * and follows the cover in "artwork". Held in a variable rather than computed on demand so that
 * a component can read it during a render without reading the clock, which is not something a
 * render is allowed to do.
 */
function refreshSeed(theme: Theme): string {
  const light = resolveGround(theme, prefersDark()) === "light";
  liveSeed = seedAt(theme, Date.now(), coverSeed(theme, light));
  return liveSeed;
}

function coverSeed(theme: Theme, light: boolean): string | null {
  if (theme.accentSource !== "artwork") return null;
  const saved = readJson(SWATCH_KEY) as { hue?: unknown; sat?: unknown } | null;
  if (!saved || typeof saved.hue !== "number" || typeof saved.sat !== "number") return null;
  return artworkSeed({ h: saved.hue / 360, s: saved.sat }, light ? "light" : "dark");
}

export const getAccentSeed = () => liveSeed;

/** The seed a component should show. Re-renders when the theme moves, and only then. */
export function useAccentSeed(): string {
  return useSyncExternalStore(store.subscribe, getAccentSeed, () => DEFAULT_THEME.accent);
}

/** Call when a new cover has been sampled, so --accent-seed follows the music. */
export function noteArtworkSwatch(): void {
  const theme = getThemeSnapshot();
  if (theme.accentSource !== "artwork") return;
  refreshSeed(theme);
  apply(theme);
}

function update(patch: Partial<Theme>): void {
  const next = withMirror({ ...getThemeSnapshot(), ...patch }, prefersDark());
  refreshSeed(next);
  store.save(next);
  apply(next);
}

/* ------------------------------------------------------------------ the setters */

export const setGround = (ground: Ground) => update({ ground });
export const setAccentSource = (accentSource: AccentSource) => update({ accentSource });
export const setAccent = (accent: string) => update({ accent });
export const setContrast = (contrast: Contrast) => update({ contrast });
export const setTintSurfaces = (tintSurfaces: boolean) => update({ tintSurfaces });
export const setTextSize = (textScale: number) => update({ textScale });

export const setFont = (id: FontId, family = "") => update({ font: { id, family } });

export const setBackgroundPrefs = (patch: Partial<BackgroundPrefs>) =>
  update({ background: { ...getThemeSnapshot().background, ...patch } });

/** Back to the defaults — the banner violet, on dark, coloured by the cover. */
export const resetTheme = () => update({ ...DEFAULT_THEME });

/**
 * A colour the reader picked, with the source switched to it — unless they are cycling, where
 * the chosen colour is the base the drift starts from and picking one is not a request to stop.
 */
export function chooseAccent(accent: string): void {
  const cycling = getThemeSnapshot().accentSource === "cycle";
  update({ accent, accentSource: cycling ? "cycle" : "fixed" });
}

/* ------------------------------------------------------------------ the legacy view */

/**
 * Unchanged, and still the question palette.ts asks. "pastel" and a light custom ground are
 * both simply a light ground now, but the mirror keeps saying it in the old words.
 */
export function isLightTheme(theme: ThemeState): boolean {
  return theme.mode === "pastel" || (theme.mode === "custom" && theme.customLight);
}

/* ------------------------------------------------------------------ the runtime */

let started = false;
let cycleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Everything this layer paints. Never the ramp's own tokens: the artwork sampler writes those
 * inline on the same element, and two writers on one custom property is a race.
 */
function apply(theme: Theme): void {
  if (typeof document === "undefined") return;

  const light = resolveGround(theme, prefersDark()) === "light";
  setVars(themeVars(theme, liveSeed, light));
  setFlag("contrast", theme.contrast === "high" ? "high" : null);
  setFlag("tint", theme.tintSurfaces ? null : "off");
  setTextScale(theme.textScale);
  applyFont(theme.font.id, theme.font.family);
  applyBackgroundPrefs(theme.background, light);
  paintBackground();
  scheduleCycle(theme);
}

/**
 * "Changes every time", for a reader who does not want the cover deciding. The colour is a
 * function of the wall clock — see `seedAt` — so this timer only has to nudge the store at each
 * boundary; it never decides what the colour is, and nothing about the drift is persisted.
 *
 * Held still under prefers-reduced-motion. The transition between two colours is an animation
 * whatever it is animating, and a reader who asked for less of that meant this too; they still
 * get a colour, it just stops moving.
 */
function scheduleCycle(theme: Theme): void {
  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }
  if (theme.accentSource !== "cycle" || prefersReducedMotion()) return;

  cycleTimer = setTimeout(() => {
    cycleTimer = null;
    const next = withMirror(getThemeSnapshot(), prefersDark());
    // The seed is refreshed *before* the publish: subscribers render off it, and a publish that
    // arrives first would paint them one step behind for a frame.
    refreshSeed(next);
    // Published, not saved: the drift is derived, and writing it every 45 seconds would wake
    // every other tab for a value they can each work out for themselves.
    store.publish(next);
    apply(next);
  }, msToNextStep(Date.now()) + 50);
}

function start(theme: Theme): void {
  if (started) return;
  started = true;

  refreshSeed(theme);
  apply(theme);

  // A reader on "Match my device" should follow it while the tab is open, not only at load.
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const current = getThemeSnapshot();
    if (current.ground !== "system") return;
    const next = withMirror(current, prefersDark());
    refreshSeed(next);
    store.publish(next);
    apply(next);
  });
}
