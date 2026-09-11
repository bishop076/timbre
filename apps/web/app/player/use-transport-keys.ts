"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";
import { actionFor, VOLUME_STEP } from "./transport-keys";

export function useTransportKeys(): void {
  const { toggle, next, previous, setVolume, volume, current } = usePlayerControls();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFor(event);
      if (!action) return;

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
