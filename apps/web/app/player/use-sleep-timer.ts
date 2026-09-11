"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";
import { cancelSleepTimer, useSleepTimer, whenDue } from "./sleep-timer.ts";

export function useSleepTimerDriver(): void {
  const { state, toggle } = usePlayerControls();
  const timer = useSleepTimer();

  useEffect(() => {
    if (timer.kind !== "due") return;
    const action = whenDue(state);
    if (action === "wait") return;
    if (action === "pause") toggle();
    cancelSleepTimer();
  }, [timer, state, toggle]);
}
