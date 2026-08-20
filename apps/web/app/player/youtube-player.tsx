"use client";

import { useEffect, useRef } from "react";

import { log } from "../logs.ts";
import { usePlayerControls } from "./player-context";

/**
 * The YouTube IFrame player, deliberately visible — the policies forbid hiding it. Three
 * traps: `new YT.Player(node)` *replaces* the node, so a React-managed element makes the
 * two fight over the same DOM and it silently fails to init; it must be at least 200×200,
 * or playback fails with a "Video unavailable" that reads like an ad blocker; and no
 * `origin` player var on a local http origin.
 */

interface YTPlayer {
  loadVideoById(id: string): void;
  /** All three undocumented but present on every shipped player, so optional. */
  unloadModule?(name: string): void;
  setOption?(name: string, option: string, value: unknown): void;
  getOptions?(): string[];
  playVideo(): void;
  pauseVideo(): void;
  /** Stops and unloads, unlike `pauseVideo`. Used when the controller lets a song go. */
  stopVideo(): void;
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

/**
 * Turns YouTube's own captions off. Captions load *after* the video, so unloading on ready
 * or right after `loadVideoById` silently does nothing (hence `onApiChange` plus retries),
 * and the module is `captions` on some builds and `cc` on others, so both are tried.
 */
function unloadCaptions(player: YTPlayer | null): void {
  if (!player) return;

  let loaded: string[] = [];
  try {
    loaded = player.getOptions?.() ?? [];
  } catch {
    // Older build without the call.
  }

  // Named `name`, not `module` — Next reserves that identifier and won't compile.
  for (const name of new Set([...loaded, "captions", "cc"])) {
    if (name !== "captions" && name !== "cc") continue;
    try {
      player.setOption?.(name, "track", {});
    } catch {
      // Module absent on this build.
    }
    try {
      player.unloadModule?.(name);
    } catch {
      // Same.
    }
  }
}

/** Retry delays in ms after playback starts, covering the window a late caption module can appear in. */
const CAPTION_RETRIES = [0, 500, 1500];

const API_SRC = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    // The only handshake the API offers, and it must be set before the script runs.
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
 * The embedded YouTube player. `size` is a prop, not a fixed class, because docked and
 * expanded must be the same element — moving it re-parents the iframe, which reloads it.
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
  } = usePlayerControls();

  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingId = useRef<string | null>(null);
  const captionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  // The callbacks register once and close over the first render's `videoId` for ever.
  const videoIdRef = useRef<string | null>(videoId);
  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  // Mute is a level of zero, not YouTube's mute() — the two can't then disagree.
  const level = muted ? 0 : volume;
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
    if (readyRef.current) playerRef.current?.setVolume(level);
  }, [level]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || playerRef.current) return;

    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    container.append(host);

    let cancelled = false;

    // A DNS-level ad blocker can stop the IFrame API loading, with nothing to explain it.
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
          // Hides the controls, not the functionality — Required Minimum Functionality
          // asks only that play, pause and seek exist, and the bar has them.
          controls: 0,
          disablekb: 1,
          // Half the job: ignored when the viewer has "always show captions" set.
          cc_load_policy: 0,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            // A fresh player starts at full, so a source switch would undo the volume.
            playerRef.current?.setVolume(levelRef.current);
            unloadCaptions(playerRef.current);
            if (pendingId.current) {
              playerRef.current?.loadVideoById(pendingId.current);
              unloadCaptions(playerRef.current);
              pendingId.current = null;
            }
          },
          onApiChange: () => {
            unloadCaptions(playerRef.current);
          },
          onStateChange: (event: { data: number }) => {
            // Nothing the iframe says once the controller has let the id go is about the
            // song on screen. `stopVideo()` below reports a state of its own, and an upload
            // cancelled mid-load can still emit one after; either would be read as the new
            // song pausing, or — if it arrives as ENDED — advance the queue past a track
            // that never played.
            if (!videoIdRef.current) return;

            const { ENDED, PLAYING, PAUSED, BUFFERING, CUED } = YT.PlayerState;
            // Backstop for players that never fire `onApiChange`. Clear pending timers
            // first: `PLAYING` fires on every resume, so the array grew by three each time.
            if (event.data === PLAYING) {
              for (const timer of captionTimers.current) clearTimeout(timer);
              captionTimers.current = CAPTION_RETRIES.map((delay) =>
                setTimeout(() => unloadCaptions(playerRef.current), delay),
              );
            }
            if (event.data === ENDED) handlers.current.handleEnded();
            else if (event.data === PLAYING) handlers.current.handleStateChange("playing");
            else if (event.data === PAUSED) handlers.current.handleStateChange("paused");
            else if (event.data === BUFFERING) handlers.current.handleStateChange("loading");
            // CUED is loaded-but-not-started, normally blocked autoplay: report paused.
            else if (event.data === CUED) handlers.current.handleStateChange("paused");
          },
          onError: (event: { data: number }) => {
            // Same reason as `onStateChange`: an error for an upload already let go would
            // start a fall-through hunt for a song nobody is waiting on any more.
            if (!videoIdRef.current) return;

            // Log the raw code, never just the sentence (BUGS.md B-6): a player under
            // 200×200 (B-1) and a barred embed (B-2) produce the same friendly text, so
            // the message alone asserts a cause nobody checked.
            const note = `YouTube IFrame error ${event.data} on video ${videoIdRef.current ?? "(none)"}`;
            console.warn(`[timbre] ${note}`);
            log("error", note);

            // 101 and 150 are embedding barred reported two ways, 100 a removed upload —
            // all three belong to *this* upload, so another copy is worth trying. Code 2 is
            // ours to fix, and retrying it only loops.
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
        // destroy() throws if the player never initialised — routine under StrictMode.
        playerRef.current?.destroy();
      } catch {
        // Nothing to clean up.
      }
      playerRef.current = null;
      for (const timer of captionTimers.current) clearTimeout(timer);
      captionTimers.current = [];
      readyRef.current = false;
      host.remove();
    };
  }, []);

  useEffect(() => {
    /*
     * **A null id has to stop the player, not merely be ignored.**
     *
     * Every other source stops by disappearing: `now-playing.tsx` picks its player from
     * `soundcloudUrl`, `mixcloudKey`, `spotifyTrackId` and `streamUrl`, so clearing one
     * unmounts the component and takes the audio with it. This player is the *fallback* of
     * that chain — mounted whenever nothing else claims the slot, including before anything
     * has ever played — so it is never unmounted and cannot stop itself that way.
     *
     * Returning early on null therefore left the previous upload audible. `load()` clears
     * the id at the top of every track change, and the two ways out of its search branch
     * both end with the id still null: a song that resolves to nothing shows *"No copy of
     * this song exists"* while the song before it plays on, and the round trip in between
     * plays it under the new track's name. `stop()` is the same fault at queue end.
     *
     * The queued id goes too, or a player that only becomes ready after this starts the
     * upload that was just cancelled.
     */
    if (!videoId) {
      pendingId.current = null;
      if (readyRef.current) {
        try {
          playerRef.current?.stopVideo();
        } catch {
          // Mid-teardown, or a build without it. Nothing is left to stop either way.
        }
      }
      return;
    }

    if (readyRef.current && playerRef.current) {
      playerRef.current.loadVideoById(videoId);
      // A new video brings its own caption module back with it.
      unloadCaptions(playerRef.current);
    }
    else pendingId.current = videoId;
  }, [videoId]);

  // The IFrame API reports state but not progress, so a progress bar needs polling.
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
    // 16:9 at 200px tall is 356×200, clearing the minimum on both axes — never shrink below
    // it. `pointer-events: none` makes this a display: `controls: 0` still leaves a hover
    // overlay that no parameter turns off.
    <div
      ref={containerRef}
      className={`pointer-events-none select-none overflow-hidden bg-black ${size}`}
      style={{ minHeight: 200, minWidth: 200 }}
      aria-label="YouTube player"
    />
  );
}
