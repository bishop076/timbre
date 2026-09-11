"use client";

import { useEffect, type RefObject } from "react";

import { cover } from "../artwork-url";
import { useLatest } from "./embed";
import { usePlayerControls } from "./player-context";

const ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekto",
  "seekbackward",
  "seekforward",
];

const REPORTS = ["durationchange", "seeked", "play", "pause", "ratechange"] as const;

function set(session: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    session.setActionHandler(action, handler);
  } catch {}
}

export function useMediaSession(audioRef: RefObject<HTMLAudioElement | null>): void {
  const { current, hasNext, next, previous, playingPreview } = usePlayerControls();
  const actions = useLatest({ next, previous });

  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const art = current && cover(current.artworkUrl, 512);
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: playingPreview ? `${current.title} (preview)` : current.title,
          artist: current.artists.join(", "),
          album: current.album ?? "",
          artwork: art ? [{ src: art, sizes: "512x512" }] : [],
        })
      : null;
  }, [current, playingPreview]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      set(navigator.mediaSession, "nexttrack", hasNext ? () => actions.current.next() : null);
    }
  }, [hasNext, actions]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const audio = () => audioRef.current;

    set(session, "play", () => void audio()?.play().catch(() => undefined));
    set(session, "pause", () => audio()?.pause());
    set(session, "previoustrack", () => actions.current.previous());
    set(session, "seekto", (details) => {
      const element = audio();
      if (!element || details.seekTime === undefined || !Number.isFinite(element.duration)) return;
      element.currentTime = Math.min(Math.max(0, details.seekTime), element.duration);
    });
    set(session, "seekbackward", (details) => {
      const element = audio();
      if (element) element.currentTime = Math.max(0, element.currentTime - (details.seekOffset ?? 10));
    });
    set(session, "seekforward", (details) => {
      const element = audio();
      if (element && Number.isFinite(element.duration)) {
        element.currentTime = Math.min(element.duration, element.currentTime + (details.seekOffset ?? 10));
      }
    });

    const element = audio();
    const report = () => {
      if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
      try {
        session.setPositionState({
          duration: element.duration,
          position: Math.min(element.currentTime, element.duration),
          playbackRate: element.playbackRate || 1,
        });
      } catch {}
    };
    for (const type of REPORTS) element?.addEventListener(type, report);

    return () => {
      for (const type of REPORTS) element?.removeEventListener(type, report);
      for (const action of ACTIONS) set(session, action, null);
      session.metadata = null;
      try {
        session.setPositionState();
      } catch {}
    };
  }, [audioRef, actions]);
}
