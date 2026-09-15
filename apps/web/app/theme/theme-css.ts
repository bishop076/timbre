"use client";

/**
 * Writing the customisation layer's variables onto the document.
 *
 * The rules that give these variables something to do live in globals.css, beside the @property
 * registrations that let the colours among them transition rather than snap. They were adopted
 * from a constructed stylesheet here for a while, so the background picture and the chosen font
 * were not inert while globals.css was being rewritten; that is done, so this file only writes
 * values now.
 */

/** Sets or removes custom properties on :root. A null value removes. */
export function setVars(vars: Record<string, string | null>): void {
  if (typeof document === "undefined") return;
  const { style } = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    if (value === null) style.removeProperty(name);
    else style.setProperty(name, value);
  }
}

/** Sets or removes a data attribute on <html>, which is how the CSS above switches. */
export function setFlag(name: string, value: string | null): void {
  if (typeof document === "undefined") return;
  const { dataset } = document.documentElement;
  if (value === null) delete dataset[name];
  else dataset[name] = value;
}

/**
 * Which ground the *browser's own* widgets should be drawn for.
 *
 * Everything Timbre paints follows --bg. Everything the user agent paints does not: scrollbars,
 * the caret, ::selection's default pair, Chrome's autofill fill, and the spin and picker
 * controls inside a date or number field. Those follow `color-scheme`, and the app never
 * declared one — so they were all drawn for `normal`, which is light. On the dark ground that
 * is a white scrollbar with white arrow buttons down the side of a near-black panel, which is
 * exactly what /stats shows in its "Read the numbers" table.
 *
 * It has to be the *resolved* ground, not the device preference: someone reading the light
 * theme on a dark-set machine wants light widgets, and `color-scheme: light dark` would give
 * them dark ones. One value, the one the page is actually wearing.
 */
export function setColorScheme(light: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.colorScheme = light ? "light" : "dark";
}

/**
 * The root font size, as a percentage. Every size in the app is in rem, so this is the one
 * knob that scales the whole interface — including the player bar and the safe-area padding —
 * without a single component knowing about it.
 */
export function setTextScale(scale: number): void {
  if (typeof document === "undefined") return;
  const { style } = document.documentElement;
  if (scale === 1) style.removeProperty("font-size");
  else style.setProperty("font-size", `${Math.round(scale * 100)}%`);
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const prefersDark = (): boolean =>
  typeof window === "undefined" || window.matchMedia?.("(prefers-color-scheme: dark)").matches !== false;
