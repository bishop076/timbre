"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";
import { actionFor, VOLUME_STEP } from "./transport-keys";

/**
 * Keyboard transport, mounted once by the app shell. Media keys and the iframe's own
 * controls act on YouTube's player, not on Timbre's queue, so without this there is no
 * keyboard route to the queue. Space, ← and → are claimed with `preventDefault` because the
 * browser scrolls with all three; volume is not, since a page that will not scroll with the
 * arrow keys is the worse trade. Bound to `window` in the capture phase so a focused element
 * cannot swallow the key first; what must *not* be intercepted is in `transport-keys.ts`.
 */
export function useTransportKeys(): void {
  const { toggle, next, previous, setVolume, volume, current } = usePlayerControls();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFor(event);
      if (!action) return;

      // Nothing loaded: leave the keys alone rather than swallow Space on a scrolling page.
      if (!current) return;

      switch (action) {
        case "toggle":
          event.preventDefault();
          toggle();
          break;
        case "next":
          event.preventDefault();
          next();
          break;
        case "previous":
          event.preventDefault();
          previous();
          break;
        case "volume-up":
          setVolume(Math.min(100, volume + VOLUME_STEP));
          break;
        case "volume-down":
          setVolume(Math.max(0, volume - VOLUME_STEP));
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, next, previous, setVolume, toggle, volume]);
}
