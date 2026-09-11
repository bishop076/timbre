"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";
import { actionFor, VOLUME_STEP } from "./transport-keys";

export function useTransportKeys(): void {
  const { toggle, next, previous, setVolume, volume, current } = usePlayerControls();

  useEffect(() => {
    const transport = { toggle, next, previous };
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFor(event);
      if (!action || !current) return;

      if (action === "volume-up") setVolume(volume + VOLUME_STEP);
      else if (action === "volume-down") setVolume(volume - VOLUME_STEP);
      else {
        event.preventDefault();
        transport[action]();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, next, previous, setVolume, toggle, volume]);
}
