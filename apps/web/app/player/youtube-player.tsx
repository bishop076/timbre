"use client";

import { useEffect, useRef } from "react";

import { usePlayer } from "./player-context";

/**
 * The YouTube IFrame player.
 *
 * **The player is deliberately visible.** YouTube's Developer Policies forbid
 * hiding or obscuring it, and forbid isolating audio from video — so Timbre
 * shows the real player rather than dressing an invisible one in its own
 * controls. It sits in the player bar at a real 16:9 size.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. `new YT.Player(node)` **replaces** the node it is given. Handing it a
 *    React-managed element makes React and YouTube fight over the same DOM,
 *    and the player silently fails to initialise. So a plain div is created
 *    imperatively for YouTube to consume, inside a container React owns.
 *
 * 2. The player must be **created at a real size**. Building it inside a
 *    zero-width box produces a player that never becomes ready.
 */

interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: unknown) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    // The API calls this global when it is ready; it is the only handshake
    // it offers, and it must be set before the script runs.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };

    if (!document.querySelector(`script[src="${API_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = API_SRC;
      script.async = true;
      document.head.append(script);
    }
  });

  return apiPromise;
}

export function YouTubePlayer() {
  const { videoId, handleEnded, handleStateChange, handleProgress, registerToggle, registerSeek } =
    usePlayer();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingId = useRef<string | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress };
  }, [handleEnded, handleStateChange, handleProgress]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || playerRef.current) return;

    // A node of our own for YouTube to replace, so React never touches it.
    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    container.append(host);

    let cancelled = false;

    void loadApi().then((YT) => {
      if (cancelled) return;

      playerRef.current = new YT.Player(host, {
        width: "100%",
        height: "100%",
        playerVars: {
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            if (pendingId.current) {
              playerRef.current?.loadVideoById(pendingId.current);
              pendingId.current = null;
            }
          },
          onStateChange: (event: { data: number }) => {
            const { ENDED, PLAYING, PAUSED, BUFFERING, CUED } = YT.PlayerState;
            if (event.data === ENDED) handlers.current.handleEnded();
            else if (event.data === PLAYING) handlers.current.handleStateChange("playing");
            else if (event.data === PAUSED) handlers.current.handleStateChange("paused");
            else if (event.data === BUFFERING) handlers.current.handleStateChange("loading");
            // CUED means the video loaded but did not start — normally because
            // the browser blocked autoplay. Report it as paused so the bar
            // offers a play button instead of spinning forever.
            else if (event.data === CUED) handlers.current.handleStateChange("paused");
          },
          onError: () => {
            // Embedding disabled, age-restricted, or removed. Skip rather than
            // stall the queue on a track that will never start.
            handlers.current.handleStateChange("unplayable");
            handlers.current.handleEnded();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try {
        // destroy() throws if the player never finished initialising, which
        // happens routinely under React's development double-mount.
        playerRef.current?.destroy();
      } catch {
        // Nothing to clean up.
      }
      playerRef.current = null;
      readyRef.current = false;
      host.remove();
    };
  }, []);

  useEffect(() => {
    if (!videoId) return;
    if (readyRef.current && playerRef.current) playerRef.current.loadVideoById(videoId);
    // The API may still be loading on a first click; remember what to play.
    else pendingId.current = videoId;
  }, [videoId]);

  // Poll for position. The IFrame API reports state changes but not progress,
  // so a timer is the only way to drive a progress bar. Twice a second is
  // smooth enough and costs nothing measurable.
  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      try {
        const duration = player.getDuration();
        if (duration > 0) handlers.current.handleProgress(player.getCurrentTime(), duration);
      } catch {
        // The player can be mid-teardown; skip this tick.
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    registerSeek((seconds) => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      player.seekTo(seconds, true);
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  useEffect(() => {
    registerToggle(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      // 1 is PLAYING; anything else is safe to start.
      if (player.getPlayerState() === 1) player.pauseVideo();
      else player.playVideo();
    });
    return () => registerToggle(null);
  }, [registerToggle]);

  return (
    // Always rendered at a real size: a player built inside a zero-width box
    // never becomes ready, and hiding it would breach YouTube's policies.
    // Sized off the bar's height so a 16:9 box cannot overflow it.
    <div
      ref={containerRef}
      className="aspect-video h-14 shrink-0 overflow-hidden rounded-lg bg-black sm:h-16"
      aria-label="YouTube player"
    />
  );
}
