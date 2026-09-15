"use client";

import { useSyncExternalStore } from "react";

import { prefersReducedMotion } from "./motion";

/**
 * `prefers-reduced-motion` as a value a component can render from, for the motion that is drawn
 * rather than animated.
 *
 * `motion.ts` answers the question once, at the moment a scroll is about to start, which is all
 * a `scrollTo` needs. A shape whose geometry is recomputed every frame — the seek bar's wave —
 * has no such moment: it is re-rendered continuously, so the answer has to come back through
 * React and it has to change when the reader changes the setting, without a reload.
 *
 * Subscribed to the media query rather than read once: the OS toggle is a live thing, and
 * someone who turns it on mid-track is asking for the wave to stop now.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The server has no media queries, so its snapshot is `false` — the same answer the client gives
 * on its very first render. Returning `true` there would paint a still frame and then animate it
 * on hydration, which is the one sequence someone with vestibular sensitivity must not get.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
