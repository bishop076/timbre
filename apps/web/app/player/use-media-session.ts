"use client";

import { useEffect, useRef, type RefObject } from "react";

import { cover } from "../artwork-url";
import { usePlayerControls } from "./player-context";

/**
 * **Lock-screen and media-key controls, for the one player Timbre owns.**
 *
 * `navigator.mediaSession` describes whatever media the *top* document is playing. The
 * embeds — YouTube, SoundCloud, Mixcloud, Spotify — play inside cross-origin frames, which
 * own their own sessions and which nothing here may reach into; `notes/PLAN.md` rules that
 * out, and rightly. But Audius, the Internet Archive and the catalogues' preview clips play
 * through Timbre's own `<audio>`, and for those the session is simply ours to fill in. Without
 * it a phone's lock screen shows the tab's title and a play button, and the keyboard's
 * next-track key does nothing, because the browser has no idea there is a queue.
 *
 * This changes nothing about *whether* audio plays in the background — a media element
 * already does, and the YouTube rule against engineering that is about YouTube's player,
 * which this never touches. It only names what is playing and wires the buttons that
 * already exist on screen.
 *
 * Mounted by `progressive-audio-player.tsx` and cleared when it unmounts, so the next
 * source — an iframe that cannot use any of this — does not inherit a stale title and a set
 * of buttons that would drive the wrong player.
 */
export function useMediaSession(audioRef: RefObject<HTMLAudioElement | null>): void {
  const { current, hasNext, next, previous, playingPreview } = usePlayerControls();

  // Handlers are installed once and read the latest actions through this, rather than being
  // torn down and re-registered on every render that produced a new `next`.
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
      // A clip says it is one here too — the lock screen is the one place the bar's label
      // is not visible, and a thirty-second song with no explanation reads as a fault.
      title: playingPreview ? `${current.title} (preview)` : current.title,
      artist: current.artists.join(", "),
      album: current.album ?? "",
      artwork: art ? [{ src: art, sizes: "512x512" }] : [],
    });
  }, [current, playingPreview]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    // Offered only when it would do something, like the on-screen Next: a lock-screen button
    // that silently fails reads as the phone's fault.
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

    // The lock screen's scrubber, kept honest. `durationchange` too, since a stream reports
    // its length only once metadata has arrived.
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
        // Thrown for a position past the duration mid-seek; the next tick corrects it.
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
        // Older engines take no argument-less call; the metadata above is already gone.
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

/** Registers one handler, ignoring an action this browser does not know — `setActionHandler`
 * throws for those rather than returning, and Safari and Firefox each lack a different few. */
function set(session: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    session.setActionHandler(action, handler);
  } catch {
    // Unsupported action on this engine.
  }
}
