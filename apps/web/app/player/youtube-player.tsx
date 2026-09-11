"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { log } from "../logs.ts";
import { publishYouTubeRates, speedToApply, useSpeed } from "./playback-speed.ts";
import { usePlayerControls } from "./player-context";
import { stalledAt } from "./youtube-stall.ts";

interface YTPlayer {
  loadVideoById(id: string): void;
  unloadModule?(name: string): void;
  setOption?(name: string, option: string, value: unknown): void;
  getOptions?(): string[];
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(level: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoLoadedFraction(): number;
  setPlaybackRate?(rate: number): void;
  getPlaybackRate?(): number;
  getAvailablePlaybackRates?(): number[];
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

function unloadCaptions(player: YTPlayer | null): void {
  if (!player) return;

  let loaded: string[] = [];
  try {
    loaded = player.getOptions?.() ?? [];
  } catch {
  }

  for (const name of new Set([...loaded, "captions", "cc"])) {
    if (name !== "captions" && name !== "cc") continue;
    try {
      player.setOption?.(name, "track", {});
    } catch {
    }
    try {
      player.unloadModule?.(name);
    } catch {
    }
  }
}

const CAPTION_RETRIES = [0, 500, 1500];

const STALL_MS = 10_000;

const API_SRC = "https://www.youtube.com/iframe_api";

const PLAYER_HOST = "https://www.youtube-nocookie.com";

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
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

export function YouTubePlayer({ size = "aspect-video w-full" }: { size?: string }) {
  const {
    videoId,
    volume,
    muted,
    handleEnded,
    handleStateChange,
    handleProgress,
    handleError,
    registerToggle,
    registerSeek,
  } = usePlayerControls();

  const [chromeShowing, setChromeShowing] = useState(true);

  const [coveredId, setCoveredId] = useState(videoId);
  if (coveredId !== videoId) {
    setCoveredId(videoId);
    setChromeShowing(true);
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingId = useRef<string | null>(null);
  const captionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  const videoIdRef = useRef<string | null>(videoId);
  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  const clearStall = useCallback(() => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = null;
  }, []);

  const watchForStall = useCallback(
    (id: string) => {
      clearStall();
      stallTimer.current = setTimeout(() => {
        stallTimer.current = null;
        const player = playerRef.current;
        if (!player || !readyRef.current || videoIdRef.current !== id) return;

        let state: number;
        let loaded: number;
        let position: number;
        try {
          state = player.getPlayerState();
          loaded = player.getVideoLoadedFraction?.() ?? 0;
          position = player.getCurrentTime();
        } catch {
          return;
        }
        if (!stalledAt(state, loaded, position)) return;

        const note = `YouTube stalled on video ${id}: player state ${state}, nothing buffered after ${STALL_MS / 1000}s`;
        console.warn(`[timbre] ${note}`);
        log("error", note);
        handlers.current.handleError("YouTube accepted this copy but never delivered it.", true, {
          stalled: true,
        });
      }, STALL_MS);
    },
    [clearStall],
  );

  const level = muted ? 0 : volume;
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
    if (readyRef.current) playerRef.current?.setVolume(level);
  }, [level]);

  const speed = useSpeed();
  const speedRef = useRef(speed);

  const applySpeed = useCallback(() => {
    const player = playerRef.current;
    const id = videoIdRef.current;
    if (!player || !readyRef.current || !id) return;
    try {
      const available = player.getAvailablePlaybackRates?.() ?? [];
      publishYouTubeRates(id, available);
      const rate = speedToApply(speedRef.current, available);
      if (player.getPlaybackRate?.() !== rate) player.setPlaybackRate?.(rate);
    } catch {
    }
  }, []);

  useEffect(() => {
    speedRef.current = speed;
    applySpeed();
  }, [speed, applySpeed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || playerRef.current) return;

    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    container.append(host);

    let cancelled = false;

    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load YouTube's player. An ad blocker or network filter may be blocking it.",
          false,
        );
      }
    }, 8000);

    void loadApi().then((YT) => {
      if (cancelled) return;
      clearTimeout(blocked);

      playerRef.current = new YT.Player(host, {
        width: "100%",
        height: "100%",
        host: PLAYER_HOST,
        playerVars: {
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          cc_load_policy: 0,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current?.setVolume(levelRef.current);
            unloadCaptions(playerRef.current);
            if (pendingId.current) {
              playerRef.current?.loadVideoById(pendingId.current);
              unloadCaptions(playerRef.current);
              watchForStall(pendingId.current);
              pendingId.current = null;
            }
          },
          onApiChange: () => {
            unloadCaptions(playerRef.current);
          },
          onStateChange: (event: { data: number }) => {
            if (!videoIdRef.current) return;

            const { UNSTARTED, ENDED, PLAYING, PAUSED, BUFFERING, CUED } = YT.PlayerState;
            if (event.data !== UNSTARTED && event.data !== BUFFERING) clearStall();
            if (event.data === PLAYING) {
              for (const timer of captionTimers.current) clearTimeout(timer);
              captionTimers.current = CAPTION_RETRIES.map((delay) =>
                setTimeout(() => unloadCaptions(playerRef.current), delay),
              );
              applySpeed();
            }
            if (event.data === PLAYING) setChromeShowing(false);
            else if (event.data !== BUFFERING) setChromeShowing(true);

            if (event.data === ENDED) handlers.current.handleEnded();
            else if (event.data === PLAYING) handlers.current.handleStateChange("playing");
            else if (event.data === PAUSED) handlers.current.handleStateChange("paused");
            else if (event.data === BUFFERING) handlers.current.handleStateChange("loading");
            else if (event.data === CUED) handlers.current.handleStateChange("paused");
          },
          onError: (event: { data: number }) => {
            if (!videoIdRef.current) return;
            clearStall();

            const note = `YouTube IFrame error ${event.data} on video ${videoIdRef.current ?? "(none)"}`;
            console.warn(`[timbre] ${note}`);
            log("error", note);

            const refused = [101, 150, 153].includes(event.data);
            const reason =
              event.data === 100
                ? "That upload has been removed."
                : refused
                  ? "YouTube wouldn't play this copy here."
                  : event.data === 5
                    ? "The player couldn't load this track."
                    : "Playback was blocked.";
            handlers.current.handleError(reason, refused || event.data === 100 || event.data === 5, {
              refused,
            });
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(blocked);
      try {
        playerRef.current?.destroy();
      } catch {
      }
      playerRef.current = null;
      for (const timer of captionTimers.current) clearTimeout(timer);
      captionTimers.current = [];
      clearStall();
      readyRef.current = false;
      host.remove();
    };
  }, [applySpeed, clearStall, watchForStall]);

  useEffect(() => {
    if (!videoId) {
      pendingId.current = null;
      clearStall();
      if (readyRef.current) {
        try {
          playerRef.current?.stopVideo();
        } catch {
        }
      }
      return;
    }

    if (readyRef.current && playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      unloadCaptions(playerRef.current);
      watchForStall(videoId);
    }
    else pendingId.current = videoId;
  }, [videoId, clearStall, watchForStall]);

  useEffect(() => {
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      try {
        const duration = player.getDuration();
        if (duration > 0) handlers.current.handleProgress(player.getCurrentTime(), duration);
      } catch {
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
      if (player.getPlayerState() === 1) player.pauseVideo();
      else player.playVideo();
    });
    return () => registerToggle(null);
  }, [registerToggle]);

  return (
    <div
      className={`pointer-events-none relative select-none overflow-hidden bg-black ${size}`}
      style={{ minHeight: 200, minWidth: 200 }}
    >
      <div ref={containerRef} className="absolute inset-0" aria-label="YouTube player" />
      {chromeShowing && <div className="absolute inset-0 bg-black" aria-hidden="true" />}
    </div>
  );
}
