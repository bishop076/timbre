"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { log } from "../logs.ts";
import { publishYouTubeRates, speedToApply, useSpeed } from "./playback-speed.ts";
import { usePlayerControls } from "./player-context";
import { stalledAt } from "./youtube-stall.ts";

/**
 * The YouTube IFrame player, deliberately visible while it plays — the policies forbid
 * hiding it, and nothing here covers a running video. A stopped one is covered, because
 * YouTube paints its own title bar and buttons over it and no parameter turns that off;
 * see `chromeShowing` below for why that is the only lever left. Three
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
  /** How much of the video is buffered, 0–1. Still zero after {@link STALL_MS} is the stall. */
  getVideoLoadedFraction(): number;
  /** Documented, but optional like the three above: a build without them only loses speed. */
  setPlaybackRate?(rate: number): void;
  getPlaybackRate?(): number;
  /** `[1]` for a video YouTube will not play at any other speed. */
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

/**
 * How long a freshly loaded upload may sit at 0:00 with nothing buffered before it is
 * treated as refused.
 *
 * **There is a failure YouTube never reports.** Measured 2026-08-30 from a Datacamp VPN
 * exit against the hosted build: the player accepts the video — `playabilityStatus: OK`,
 * 24 formats — and then every `videoplayback` request to googlevideo.com answers **403**.
 * The player re-fetches its config every 1.5s and alternates UNSTARTED and BUFFERING with
 * `videoLoadedFraction` at exactly zero for as long as anyone waits. No `onError` ever
 * fires, so the ladder never runs, and the bar shows a spinner at 0:00 until the reader
 * gives up. Two songs, two browsers, one with an ad blocker and one without: identical.
 *
 * The same address gets a clean error `150` on a plain-http origin, which is why this was
 * invisible in local development and why B-1's advice to log the numeric code found
 * nothing here — there is no code. Like SoundCloud's `STALL_MS`, this is a timeout rather
 * than a detection: nothing on this side can tell a refused media server from a slow one,
 * so `stalledAt` also requires that *nothing* has buffered, which a merely slow start
 * stops being true of within a second or two. See docs/BUGS.md B-18.
 */
const STALL_MS = 10_000;

const API_SRC = "https://www.youtube.com/iframe_api";

/**
 * The embed itself is served from youtube-nocookie.com — and this is not the privacy
 * gesture it looks like. It is what makes playback work at all from a network YouTube
 * distrusts.
 *
 * Measured 2026-09-05 from a Datacamp VPN exit, under the real hosted origin, with this
 * component's exact sequence (player constructed empty, `loadVideoById` on ready,
 * `controls: 0`): on www.youtube.com the player reported OK and googlevideo.com then
 * answered 403 to the media — the B-18 stall — every time, UNSTARTED and BUFFERING for
 * ever. The same sequence with `host` set here went UNSTARTED → BUFFERING → PLAYING and
 * was fourteen seconds in after sixteen, every media request 200. A plain `<iframe>` on
 * each host behaved the same way, so it is the host and not the API. What pointed here
 * was the reader: youtube.com itself played in a first-party tab from the same exit and
 * the same browser, so the address was not simply barred. See docs/BUGS.md B-19.
 *
 * Why the two hosts are judged differently is YouTube's to know; what is measurable is
 * that the privacy-enhanced embed is treated more leniently by the media servers. `host`
 * changes only where the iframe points — the API script above still comes from
 * www.youtube.com — so `frame-src` in next.config.ts names both.
 */
const PLAYER_HOST = "https://www.youtube-nocookie.com";

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

  /**
   * Whether YouTube is painting its own furniture over the video: the title, the channel
   * avatar, a share link and a *Watch on YouTube* button. It appears in every state except
   * playing and stays until playback resumes, so on a paused song it simply sits there.
   *
   * No player var turns it off. `modestbranding` was deprecated on 2023-08-15 and the
   * documentation now says it "has no effect" — the player picks its own branding from the
   * size and the other parameters instead — and `rel: 0` has not removed related videos
   * since 2018, it only keeps them to the same channel. Both are kept below because they
   * are harmless, but neither is doing anything here.
   *
   * Starts up, because a player that has not begun is showing it.
   */
  const [chromeShowing, setChromeShowing] = useState(true);

  /**
   * Puts the cover back for a new track, during render rather than from an effect — the
   * adjustment React documents for state that has to follow a prop, and the one shape
   * `react-hooks/set-state-in-effect` allows. It cannot wait for `onStateChange`:
   * `loadVideoById` goes straight to BUFFERING, which is deliberately ignored below, so
   * a song started while the last one was playing would show its title uncovered until
   * the first frame arrived.
   */
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
  /** The pending stall check, if any. One at a time: every load restarts the clock. */
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  // The callbacks register once and close over the first render's `videoId` for ever.
  const videoIdRef = useRef<string | null>(videoId);
  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  const clearStall = useCallback(() => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = null;
  }, []);

  /**
   * Gives one upload {@link STALL_MS} to buffer anything at all, and reports a refusal if
   * it does not. Cleared by the first state that proves the player is running — or that
   * the reader stopped it — and by `onError`, which is the failure that *does* announce
   * itself and needs no timer.
   *
   * Reported as `worthRetrying` with `stalled` set: the ladder should leave the song's
   * YouTube copies rather than walk them, because the refusal measured here answers the
   * address and not the upload — see `handleError` in `player-context.tsx`.
   */
  const watchForStall = useCallback(
    (id: string) => {
      clearStall();
      stallTimer.current = setTimeout(() => {
        stallTimer.current = null;
        const player = playerRef.current;
        // The controller has moved on, or the player is gone: nothing left to judge.
        if (!player || !readyRef.current || videoIdRef.current !== id) return;

        let state: number;
        let loaded: number;
        let position: number;
        try {
          state = player.getPlayerState();
          loaded = player.getVideoLoadedFraction?.() ?? 0;
          position = player.getCurrentTime();
        } catch {
          // Mid-teardown. The next load arms a fresh check.
          return;
        }
        if (!stalledAt(state, loaded, position)) return;

        // Logged like an error code would be (B-6): the state is the only number there is.
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

  // Mute is a level of zero, not YouTube's mute() — the two can't then disagree.
  const level = muted ? 0 : volume;
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
    if (readyRef.current) playerRef.current?.setVolume(level);
  }, [level]);

  const speed = useSpeed();
  const speedRef = useRef(speed);

  /**
   * Hands YouTube the preferred speed if this video offers it, normal speed if not, and
   * reports what it does offer so the menu can say.
   *
   * Run on every PLAYING rather than once per load: `loadVideoById` does not promise to keep
   * the rate, and PLAYING is the first moment `getAvailablePlaybackRates` describes the new
   * video rather than the last one. Setting only when the rate differs keeps the
   * BUFFERING → PLAYING a rate change can cause from coming straight back here to do it again.
   */
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
      // Mid-teardown. The next PLAYING tries again.
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
        host: PLAYER_HOST,
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
              watchForStall(pendingId.current);
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

            const { UNSTARTED, ENDED, PLAYING, PAUSED, BUFFERING, CUED } = YT.PlayerState;
            // Anything but the two "trying" states settles the stall question: PLAYING and
            // ENDED mean media arrived, PAUSED and CUED mean the reader or the browser
            // stopped it, and neither is a refusal.
            if (event.data !== UNSTARTED && event.data !== BUFFERING) clearStall();
            // Backstop for players that never fire `onApiChange`. Clear pending timers
            // first: `PLAYING` fires on every resume, so the array grew by three each time.
            if (event.data === PLAYING) {
              for (const timer of captionTimers.current) clearTimeout(timer);
              captionTimers.current = CAPTION_RETRIES.map((delay) =>
                setTimeout(() => unloadCaptions(playerRef.current), delay),
              );
              applySpeed();
            }
            // Only PLAYING takes the cover down, and only a settled state puts it back:
            // a seek runs PLAYING → BUFFERING → PLAYING, so treating BUFFERING as stopped
            // would blink a black rectangle over a video that never actually stopped.
            if (event.data === PLAYING) setChromeShowing(false);
            else if (event.data !== BUFFERING) setChromeShowing(true);

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
            // A reported failure supersedes the timer that exists for the unreported one.
            clearStall();

            // Log the raw code, never just the sentence (BUGS.md B-6): a player under
            // 200×200 (B-1) and a barred embed (B-2) produce the same friendly text, so
            // the message alone asserts a cause nobody checked.
            const note = `YouTube IFrame error ${event.data} on video ${videoIdRef.current ?? "(none)"}`;
            console.warn(`[timbre] ${note}`);
            log("error", note);

            // 101 and 150 are embedding barred reported two ways, 100 a removed upload —
            // all three belong to *this* upload, so another copy is worth trying. Code 2 is
            // ours to fix, and retrying it only loops.
            //
            // **153 is undocumented and belongs here too.** Measured 2026-08-20 from a Swiss
            // exit: all six candidates for a territorially barred song returned 153 from a
            // bare page, and it was in none of the lists above — so `worthRetrying` came back
            // false and the ladder stopped dead at the *first* copy, with no fall-through at
            // all. In-app the same song reported a retryable code instead, which is the point:
            // the code depends on the embedding context, so it can never be used to *detect*
            // a territorial block. That is why it is only added to the retry set and nothing
            // reads it as a cause. See docs/RESEARCH-VPN-FALLTHROUGH.md.
            //
            // **150 does not reliably mean the owner either.** Measured 2026-09-10 from a VPN
            // exit: every video answered 150, YouTube's own API sample included, over a player
            // response of `LOGIN_REQUIRED` — YouTube's bot wall for the address. So the three
            // share one sentence that names no cause, and travel as `refused`, which lets the
            // ladder leave YouTube once a second upload says the same (B-33).
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
        // destroy() throws if the player never initialised — routine under StrictMode.
        playerRef.current?.destroy();
      } catch {
        // Nothing to clean up.
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
      clearStall();
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
      watchForStall(videoId);
    }
    else pendingId.current = videoId;
  }, [videoId, clearStall, watchForStall]);

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
      className={`pointer-events-none relative select-none overflow-hidden bg-black ${size}`}
      style={{ minHeight: 200, minWidth: 200 }}
    >
      <div ref={containerRef} className="absolute inset-0" aria-label="YouTube player" />
      {/*
        Opaque, and only while the player is stopped. The iframe underneath is never
        resized, moved or re-parented — the API replaces its host node, so React must not
        own it, and moving it reloads the upload.

        A cover is the whole remedy available: the furniture is drawn inside a
        cross-origin iframe, so no CSS reaches it, and the parameters that used to hide it
        were withdrawn. It is deliberately not up while the video is playing.
      */}
      {chromeShowing && <div className="absolute inset-0 bg-black" aria-hidden="true" />}
    </div>
  );
}
