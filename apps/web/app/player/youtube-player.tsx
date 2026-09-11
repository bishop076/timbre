"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { log } from "../logs.ts";
import { addScript, blockedTimer, findScript, loadOnce, useLatest, useTransport } from "./embed";
import { publishYouTubeRates, speedToApply, useSpeed } from "./playback-speed.ts";
import { usePlayerControls } from "./player-context";
import { stalledAt } from "./youtube-stall.ts";

interface YTPlayer {
  loadVideoById(id: string): void;
  unloadModule?(name: string): void;
  setOption?(name: string, option: string, value: unknown): void;
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
  PlayerState: Record<"UNSTARTED" | "ENDED" | "PLAYING" | "PAUSED" | "BUFFERING" | "CUED", number>;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function quietly(action: () => void): void {
  try {
    action();
  } catch {}
}

function unloadCaptions(player: YTPlayer | null): void {
  for (const name of ["captions", "cc"]) {
    quietly(() => player?.setOption?.(name, "track", {}));
    quietly(() => player?.unloadModule?.(name));
  }
}

const CAPTION_RETRIES = [0, 500, 1500];
const STALL_MS = 10_000;
const API_SRC = "https://www.youtube.com/iframe_api";
const PLAYER_HOST = "https://www.youtube-nocookie.com";

const REFUSED = "YouTube wouldn't play this copy here.";
const RETRYABLE_ERRORS: Record<number, string> = {
  5: "The player couldn't load this track.",
  100: "That upload has been removed.",
  101: REFUSED,
  150: REFUSED,
  153: REFUSED,
};

const loadApi = loadOnce<YTNamespace>((resolve) => {
  if (window.YT?.Player) return resolve(window.YT);
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    previous?.();
    resolve(window.YT!);
  };
  if (!findScript(API_SRC)) addScript(API_SRC);
});

export function YouTubePlayer({ size = "aspect-video w-full" }: { size?: string }) {
  const controls = usePlayerControls();
  const { videoId } = controls;
  const level = controls.muted ? 0 : controls.volume;

  const [chromeShowing, setChromeShowing] = useState(true);
  const [coveredId, setCoveredId] = useState(videoId);
  if (coveredId !== videoId) {
    setCoveredId(videoId);
    setChromeShowing(true);
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const stallTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const speed = useSpeed();
  const live = useLatest({ ...controls, level, speed });

  const start = useCallback((id: string) => {
    const player = playerRef.current;
    if (!player) return;
    player.loadVideoById(id);
    unloadCaptions(player);

    clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => {
      if (!readyRef.current || live.current.videoId !== id) return;
      let state: number;
      try {
        state = player.getPlayerState();
        if (!stalledAt(state, player.getVideoLoadedFraction?.() ?? 0, player.getCurrentTime())) {
          return;
        }
      } catch {
        return;
      }
      const note = `YouTube stalled on video ${id}: player state ${state}, nothing buffered after ${STALL_MS / 1000}s`;
      console.warn(`[timbre] ${note}`);
      log("error", note);
      live.current.handleError("YouTube accepted this copy but never delivered it.", true, {
        stalled: true,
      });
    }, STALL_MS);
  }, [live]);

  useEffect(() => {
    if (readyRef.current) playerRef.current?.setVolume(level);
  }, [level]);

  const applySpeed = useCallback(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    quietly(() => {
      const { videoId: id, speed: preferred } = live.current;
      if (!id) return;
      const available = player.getAvailablePlaybackRates?.() ?? [];
      publishYouTubeRates(id, available);
      const rate = speedToApply(preferred, available);
      if (player.getPlaybackRate?.() !== rate) player.setPlaybackRate?.(rate);
    });
  }, [live]);

  useEffect(() => applySpeed(), [speed, applySpeed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const host = document.createElement("div");
    Object.assign(host.style, { width: "100%", height: "100%" });
    container.append(host);

    let cancelled = false;
    let captionTimers: ReturnType<typeof setTimeout>[] = [];

    const clearBlocked = blockedTimer("YouTube", (reason) =>
      live.current.handleError(reason, false),
    );

    void loadApi().then((YT) => {
      if (cancelled) return;
      clearBlocked();

      const { UNSTARTED, ENDED, PLAYING, PAUSED, BUFFERING, CUED } = YT.PlayerState;
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
            playerRef.current?.setVolume(live.current.level);
            unloadCaptions(playerRef.current);
            if (live.current.videoId) start(live.current.videoId);
          },
          onApiChange: () => unloadCaptions(playerRef.current),
          onStateChange: ({ data }: { data: number }) => {
            if (!live.current.videoId) return;

            if (data !== UNSTARTED && data !== BUFFERING) clearTimeout(stallTimer.current);
            if (data === PLAYING) {
              captionTimers.forEach(clearTimeout);
              captionTimers = CAPTION_RETRIES.map((delay) =>
                setTimeout(() => unloadCaptions(playerRef.current), delay),
              );
              applySpeed();
              setChromeShowing(false);
            } else if (data !== BUFFERING) setChromeShowing(true);

            if (data === ENDED) live.current.handleEnded();
            else if (data === PLAYING) live.current.handleStateChange("playing");
            else if (data === BUFFERING) live.current.handleStateChange("loading");
            else if (data === PAUSED || data === CUED) live.current.handleStateChange("paused");
          },
          onError: ({ data }: { data: number }) => {
            if (!live.current.videoId) return;
            clearTimeout(stallTimer.current);

            const note = `YouTube IFrame error ${data} on video ${live.current.videoId}`;
            console.warn(`[timbre] ${note}`);
            log("error", note);

            const reason = RETRYABLE_ERRORS[data];
            live.current.handleError(reason ?? "Playback was blocked.", Boolean(reason), {
              refused: reason === REFUSED,
            });
          },
        },
      });
    });

    const poll = setInterval(() => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      quietly(() => {
        const duration = player.getDuration();
        if (duration > 0) live.current.handleProgress(player.getCurrentTime(), duration);
      });
    }, 500);

    return () => {
      cancelled = true;
      clearBlocked();
      clearInterval(poll);
      quietly(() => playerRef.current?.destroy());
      playerRef.current = null;
      captionTimers.forEach(clearTimeout);
      clearTimeout(stallTimer.current);
      readyRef.current = false;
      host.remove();
    };
  }, [applySpeed, live, start]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !readyRef.current) return;
    if (videoId) {
      start(videoId);
    } else {
      clearTimeout(stallTimer.current);
      quietly(() => player.stopVideo());
    }
  }, [videoId, start]);

  useTransport({
    toggle: () => {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      if (player.getPlayerState() === 1) player.pauseVideo();
      else player.playVideo();
    },
    seek: (seconds) => {
      if (readyRef.current) playerRef.current?.seekTo(seconds, true);
    },
  });

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
