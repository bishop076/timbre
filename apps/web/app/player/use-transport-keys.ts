"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";
import { runTransport } from "./transport-keys";

export function useTransportKeys(): void {
  const { toggle, next, previous, setVolume, volume, current } = usePlayerControls();

  useEffect(() => {
    const transport = current ? { toggle, next, previous, setVolume, volume } : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (runTransport(event, transport)) event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, next, previous, setVolume, toggle, volume]);
}
