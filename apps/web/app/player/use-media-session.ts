"use client";

import { useEffect, useRef, type RefObject } from "react";

import { cover } from "../artwork-url";
import { usePlayerControls } from "./player-context";

export function useMediaSession(audioRef: RefObject<HTMLAudioElement | null>): void {
  const { current, hasNext, next, previous, playingPreview } = usePlayerControls();

  const actions = useRef({ next, previous });
  useEffect(() => {
    actions.current = { next, previous };
  }, [next, previous]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const session = navigator.mediaSession;
    if (!current) {
      session.metadata = null;
      return;
    }

    const art = cover(current.artworkUrl, 512);
    session.metadata = new MediaMetadata({
      title: playingPreview ? `${current.title} (preview)` : current.title,
      artist: current.artists.join(", "),
      album: current.album ?? "",
      artwork: art ? [{ src: art, sizes: "512x512" }] : [],
    });
  }, [current, playingPreview]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    set(session, "nexttrack", hasNext ? () => actions.current.next() : null);
  }, [hasNext]);

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
      } catch {
      }
    };
    element?.addEventListener("durationchange", report);
    element?.addEventListener("seeked", report);
    element?.addEventListener("play", report);
    element?.addEventListener("pause", report);
    element?.addEventListener("ratechange", report);

    return () => {
      element?.removeEventListener("durationchange", report);
      element?.removeEventListener("seeked", report);
      element?.removeEventListener("play", report);
      element?.removeEventListener("pause", report);
      element?.removeEventListener("ratechange", report);
      for (const action of ACTIONS) set(session, action, null);
      session.metadata = null;
      try {
        session.setPositionState();
      } catch {
      }
    };
  }, [audioRef]);
}

const ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekto",
  "seekbackward",
  "seekforward",
];

function set(session: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    session.setActionHandler(action, handler);
  } catch {
  }
}
