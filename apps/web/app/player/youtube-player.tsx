"use client";

import { useEffect, useRef } from "react";

import { usePlayer } from "./player-context";

/**
 * The YouTube IFrame player.
 *
 * **The player is deliberately visible.** YouTube's Developer Policies forbid
 * hiding or obscuring it, and forbid isolating audio from video — so Timbre
 * shows the real player rather than dressing an invisible one in its own
 * controls. It sits in the player bar at a small but genuine 16:9 size.
 *
 * Background playback is not engineered around either. On desktop a background
 * tab keeps playing by itself, exactly as youtube.com does; on mobile it stops
 * when the screen locks, which is the feature YouTube Premium sells.
 */

// Minimal shape of the bits of the IFrame API actually used.
interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: unknown) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";

/** Loads the IFrame API once per page, shared by every caller. */
let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    // The API calls this global when it finishes loading; it is the only
    // handshake it offers.
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);

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
  const { videoId, handleEnded, handleStateChange, registerToggle } = usePlayer();

  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const pendingId = useRef<string | null>(null);

  // Latest callbacks, so the player is created once rather than rebuilt
  // whenever a handler identity changes. Written in an effect rather than
  // during render, which React forbids.
  const handlers = useRef({ handleEnded, handleStateChange });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange };
  }, [handleEnded, handleStateChange]);

  useEffect(() => {
    let cancelled = false;

    void loadApi().then((YT) => {
      if (cancelled || !mountRef.current || playerRef.current) return;

      playerRef.current = new YT.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          // No related videos from other channels, and no YouTube branding
          // beyond what the player itself shows.
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            if (pendingId.current) {
              playerRef.current?.loadVideoById(pendingId.current);
              pendingId.current = null;
            }
          },
          onStateChange: (event: { data: number }) => {
            const { ENDED, PLAYING, PAUSED, BUFFERING } = YT.PlayerState;
            if (event.data === ENDED) handlers.current.handleEnded();
            else if (event.data === PLAYING) handlers.current.handleStateChange("playing");
            else if (event.data === PAUSED) handlers.current.handleStateChange("paused");
            else if (event.data === BUFFERING) handlers.current.handleStateChange("loading");
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
    };
  }, []);

  useEffect(() => {
    if (!videoId) return;
    if (playerRef.current) playerRef.current.loadVideoById(videoId);
    // The player may not exist yet on a first click; remember what to play.
    else pendingId.current = videoId;
  }, [videoId]);

  useEffect(() => {
    registerToggle(() => {
      const player = playerRef.current;
      if (!player) return;
      // 1 is PLAYING; anything else means it is safe to start.
      if (player.getPlayerState() === 1) player.pauseVideo();
      else player.playVideo();
    });
    return () => registerToggle(null);
  }, [registerToggle]);

  return (
    <div
      className={`relative aspect-video shrink-0 overflow-hidden rounded-lg bg-black transition-all ${
        videoId ? "w-28 sm:w-36" : "w-0"
      }`}
    >
      <div ref={mountRef} className="size-full" />
    </div>
  );
}
