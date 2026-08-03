"use client";

import { useEffect } from "react";

import { usePlayer } from "./player-context";
import { actionFor, VOLUME_STEP } from "./transport-keys";

/**
 * Keyboard transport, mounted once by the app shell.
 *
 * These are not a convenience. Media keys and the iframe's own controls act on
 * **YouTube's player**, not on Timbre's queue — so pressing next on a keyboard
 * would advance nothing, and there was no keyboard route to the queue at all.
 * docs/PLAN.md calls for this for exactly that reason.
 *
 * Space, ← and → are claimed with `preventDefault` because the browser uses all
 * three to scroll. Volume is not: ↑ and ↓ scroll too, but a page that will not
 * scroll with the arrow keys is a worse trade than a volume step that also
 * nudges the view, and the decision is reversed the moment the page is not
 * scrollable anyway.
 *
 * Bound to `window` in the capture phase so a focused element deeper in the
 * tree cannot swallow the key first. What must *not* be intercepted is decided
 * by `transport-keys.ts`, which is unit-tested.
 */
export function useTransportKeys(): void {
  const { toggle, next, previous, setVolume, volume, current } = usePlayer();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFor(event);
      if (!action) return;

      // Nothing loaded: leave the keys to the browser rather than swallowing
      // Space on a page where it should still scroll.
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
