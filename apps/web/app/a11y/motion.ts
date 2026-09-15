/**
 * `prefers-reduced-motion` for the animations CSS cannot see.
 *
 * globals.css turns off the keyframe animations and the tint transitions, but a
 * `scrollTo({ behavior: "smooth" })` is a JavaScript decision and no stylesheet can reach it —
 * `scroll-behavior: auto` only overrides the CSS property, not the argument. Every smooth scroll
 * in the app goes through here instead.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/** `"smooth"`, unless the reader has asked for less movement. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
