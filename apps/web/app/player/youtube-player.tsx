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
 * Three things here are load-bearing and easy to get wrong:
 *
 * 1. `new YT.Player(node)` **replaces** the node it is given. Handing it a
 *    React-managed element makes React and YouTube fight over the same DOM,
 *    and the player silently fails to initialise. So a plain div is created
 *    imperatively for YouTube to consume, inside a container React owns.
 *
 * 2. **The player must be at least 200×200 pixels.** YouTube's IFrame API
 *    documents this as a minimum, and below it playback fails with a bare
 *    "Video unavailable" in every browser — which reads exactly like an ad
 *    blocker and sends you hunting in the wrong place entirely. A thumbnail
 *    in the player bar is therefore not an option; the video needs a real
 *    panel, which YouTube's policy on keeping the player visible wants anyway.
 *
 * 3. Do not pass an `origin` player var on a local http origin. It is
 *    unnecessary and is itself a common cause of "Video unavailable".
 */

interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(level: number): void;
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

/**
 * `size` sets the player's box and nothing else. It is a prop rather than a
 * fixed class because the same player is shown docked in the panel and expanded
 * over the content area, and it must be **the same element** in both — a player
 * that moved in the tree would re-parent its iframe, and a re-parented iframe
 * reloads. Whatever is passed must stay at or above 200px on both axes.
 */
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
  } = usePlayer();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingId = useRef<string | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  // Mute is a level of zero rather than YouTube's mute(), so one call covers
  // both and there is no way for the two to disagree about what is audible.
  const level = muted ? 0 : volume;
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
    if (readyRef.current) playerRef.current?.setVolume(level);
  }, [level]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || playerRef.current) return;

    // A node of our own for YouTube to replace, so React never touches it.
    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    container.append(host);

    let cancelled = false;

    // An ad blocker — especially a DNS-level one — can stop the IFrame API
    // loading at all. Without this the bar sits on a black box indefinitely
    // with nothing to explain it.
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
        playerVars: {
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          // The video is a display, not a control surface: every transport
          // action lives in Timbre's player bar, so YouTube's own overlay would
          // be a second set of buttons doing the same job in a different place.
          //
          // This hides the controls, it does not remove the functionality —
          // play, pause and seek are all still offered, which is what YouTube's
          // Required Minimum Functionality actually asks for. The player itself
          // stays visible and unobscured.
          controls: 0,
          disablekb: 1,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            // A fresh player starts at full. Applying the stored level here is
            // what stops a source switch from undoing the volume you chose.
            playerRef.current?.setVolume(levelRef.current);
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
          onError: (event: { data: number }) => {
            // 101 and 150 are the same condition reported two ways: the rights
            // holder barred embedding on this upload. 100 means it is gone.
            // All three are properties of *this upload*, so another copy of the
            // same song is worth trying. Code 2 (bad parameter) is ours to fix
            // and retrying would only loop.
            const blockedUpload = [100, 101, 150].includes(event.data);
            const reason =
              event.data === 100
                ? "That upload has been removed."
                : blockedUpload
                  ? "The owner disabled playback on other sites."
                  : event.data === 5
                    ? "The player couldn't load this track."
                    : "Playback was blocked.";
            handlers.current.handleError(reason, blockedUpload || event.data === 5);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearTimeout(blocked);
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
    // 16:9 at 200px tall is 356×200 — over YouTube's documented minimum on
    // both axes. Never shrink this below 200px in either dimension.
    // `pointer-events: none` is what actually makes this a display rather than
    // a player. `controls: 0` removes the bottom control bar, but YouTube still
    // paints a hover overlay — title, channel, share, logo, a big pause button
    // — over the picture the moment the pointer crosses it, and there is no
    // parameter that turns that off. Not taking input removes the hover state
    // entirely, so the video stays a video.
    //
    // Nothing is lost: play, pause and seek all live in the player bar, and the
    // player itself remains fully visible and unobscured.
    <div
      ref={containerRef}
      className={`pointer-events-none select-none overflow-hidden bg-black ${size}`}
      style={{ minHeight: 200, minWidth: 200 }}
      aria-label="YouTube player"
    />
  );
}
