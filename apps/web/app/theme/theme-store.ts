"use client";

import { useSyncExternalStore } from "react";

/**
 * Which palette the app wears.
 *
 * Stored outside React and outside the server, for the same reason volume is:
 * it has to survive a reload, which means `localStorage`, which the server
 * cannot read. `useSyncExternalStore` is what keeps hydration honest — the
 * server renders the default, then React re-reads the real value.
 *
 * The three modes are genuinely different ideas, not three colour swaps:
 *
 * - **`album`** — the whole interface is a tonal ramp built from the current
 *   cover, on a dark ground. The app is *made of* the album's colour.
 * - **`pastel`** — the same idea inverted: a light ground, and the cover's hue
 *   held at high lightness and gentle saturation so it reads as soft rather
 *   than bright.
 * - **`custom`** — one hue, chosen once, that never moves. For people who want
 *   the app to look the same at 3pm and at midnight regardless of what is
 *   playing, which the other two deliberately do not.
 *
 * `custom` carries its own light/dark choice because a fixed hue still needs a
 * ground to sit on, and the mode is the only one where the reader — not the
 * artwork — decides everything.
 */

export type ThemeMode = "album" | "pastel" | "custom";

export interface ThemeState {
  mode: ThemeMode;
  /** Hue in degrees, 0–359. Only consulted in `custom`, and ignored when neutral. */
  customHue: number;
  /** Whether `custom` sits on a light ground. */
  customLight: boolean;
  /**
   * No hue at all — plain white or plain dark.
   *
   * A separate flag rather than "hue with zero saturation" because it is a
   * different intent: every other choice here tints the entire interface, and
   * this one is the request to stop doing that. Storing it as a saturation of
   * zero would make it indistinguishable from a colour the reader picked and
   * would be silently undone the moment they touched a swatch.
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

    // Each field is validated on its own rather than trusting the object: this
    // is user-editable storage, and a half-valid record should degrade to the
    // default for the bad field only.
    return {
      mode: isMode(value.mode) ? value.mode : DEFAULT.mode,
      customHue: Number.isFinite(hue) && hue >= 0 && hue < 360 ? Math.round(hue) : DEFAULT.customHue,
      customLight: value.customLight === true,
      customNeutral: value.customNeutral === true,
    };
  } catch {
    // Private browsing throws rather than returning null, and malformed JSON
    // throws too. Either way the default is the right answer.
    return DEFAULT;
  }
}

function write(next: ThemeState): void {
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember the choice is no reason to refuse to make it.
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

export function getThemeSnapshot(): ThemeState {
  // Lazy so the module stays importable on the server; every read after the
  // first returns a cached object, as getSnapshot requires.
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
  // Choosing a colour is choosing the mode: adjusting the swatch while another
  // mode is active would otherwise change nothing visible and read as broken.
  // It also leaves neutral, since picking a hue is the opposite of that ask.
  write({ ...getThemeSnapshot(), customHue: wrapped, customNeutral: false, mode: "custom" });
}

export function setCustomLight(light: boolean): void {
  write({ ...getThemeSnapshot(), customLight: light, mode: "custom" });
}

/**
 * Plain white or plain dark, with no tint at all.
 *
 * Sets the ground too, because these are not a colour *and* a ground — "white"
 * already names both, and offering a dark white would be nonsense.
 */
export function setNeutral(light: boolean): void {
  write({ ...getThemeSnapshot(), customNeutral: true, customLight: light, mode: "custom" });
}

/**
 * Whether a mode paints on a light ground.
 *
 * The single place that answers it, because three separate copies of this
 * question — the palette builder, the CSS attribute and the ambient wash — is
 * three chances for them to disagree about what "light" means.
 */
export function isLightTheme(theme: ThemeState): boolean {
  if (theme.mode === "pastel") return true;
  if (theme.mode === "custom") return theme.customLight;
  return false;
}
