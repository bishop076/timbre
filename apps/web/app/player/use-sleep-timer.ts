"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";
import { cancelSleepTimer, useSleepTimer, whenDue } from "./sleep-timer.ts";

/**
 * Carries out a sleep timer that has run out. Mounted once by the app shell, which always
 * mounts — the player bar does not until something plays, and a timer whose driver had
 * unmounted would sit due until the next song started and then pause it at once.
 *
 * Pauses through `toggle`, the path every transport button takes, and only from `playing`;
 * `whenDue` says why a load is waited out rather than treated as quiet. The "end of this
 * track" option is not handled here: stopping at a track's end has to happen before the
 * queue advances, which only `handleEnded` sees.
 */
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
