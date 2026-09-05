"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { openSpotifyWindow, rememberSpotifyPreviewsOnly } from "../spotify/preview-mode.ts";
import { useSpotifyTokens } from "../spotify/token-store.ts";
import { usePlayerControls } from "./player-context";
import type { SdkOutcome } from "./spotify-sdk-player";

const SpotifySdkPlayer = dynamic(() =>
  import("./spotify-sdk-player").then((m) => m.SpotifySdkPlayer),
);

/**
 * Spotify's own embed, driven through **Spotify's Embed iFrame API**.
 *
 * **The claim this file used to make is out of date, and it shaped a lot of the project.**
 * It said: *"There is no API on it — no play, no pause, no position, no ended event. That is
 * the whole surface Spotify offers without a developer app."* That was true when it was
 * written and is not true now. Spotify ships an embed controller at
 * `https://open.spotify.com/embed/iframe-api/v1`, and measured 2026-08-20 it exposes:
 *
 * ```
 * play · playFromStart · restart · pause · resume · togglePlay · seek
 * loadUri · loadEntity · addListener · removeListener · destroy
 * ```
 *
 * Calling `play()` from script started playback — `playback_update` reported
 * `{isPaused: false, position: 6803, duration: 29713}` with nothing touched by hand. So the
 * embed *is* controllable, `docs/BLOCKED.md` and `docs/SEARCH-ROUTES.md` are wrong where they
 * say otherwise, and `playback: "manual"` in `packages/providers/src/spotify.ts` describes a
 * limit Spotify removed.
 *
 * **The `duration: 29713` is the other half of the story, and it is not about Premium.**
 * That is a thirty-second preview. The embed decides which to serve by reading the listener's
 * Spotify session — and it reads it through **third-party cookies**, because it is an iframe
 * on somebody else's origin. Chrome now blocks those by default, so the embed cannot see a
 * signed-in account, concludes there is none, and serves a clip. Spotify's own developer
 * forum carries this as a known, open complaint; it hits Premium subscribers exactly as hard
 * as free ones.
 *
 * **There is nothing this file can do about it.** The iframe Spotify's API creates carries
 * `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"` —
 * measured — with no `storage-access`, and it is Spotify's element, created and navigated by
 * their script. Granting the Storage Access API would have to be Spotify's move inside their
 * own document, not ours from outside it.
 *
 * So the embed is a clip, permanently. **What plays the whole song is the Web Playback SDK**
 * — `spotify-sdk-player.tsx` — which uses no cookies at all, and this component hands over to
 * it whenever the reader has connected an account. The SDK reports back if it cannot serve
 * them (no Premium, stale scopes, no client id) and the embed takes the song again, so the
 * fallback is never worse than it was.
 *
 * When the embed *is* what is playing, it says why it is short and what to change.
 *
 * ---
 *
 * ## The terms question, which is a decision rather than a fact
 *
 * **This now auto-starts and auto-advances, because that is what was asked for.** It is worth
 * being plain that the previous behaviour was not an accident of the API. `BLOCKED.md` argues
 * the manual panel *"is also what keeps it clear of Developer Terms §IV.2 on blending
 * streams"* — a panel a person presses is not Spotify's audio blended into a queue with
 * another service's; a queue member that starts itself and hands off to YouTube when it ends
 * is much closer to exactly that.
 *
 * Nothing here changes what Spotify serves or who it counts the play for: the audio is
 * Spotify's own embed, unmodified, and it is their player doing the playing. What changed is
 * that Timbre presses the button instead of the reader. Whether that crosses §IV.2 is a
 * judgement for whoever ships this, not something this file can settle — and reverting it is
 * small: stop calling `play()` on ready, and put the transport message back.
 */

const API_SRC = "https://open.spotify.com/embed/iframe-api/v1";

/**
 * Why the whole song is not playing, in the reader's terms.
 *
 * **The first version of this always blamed third-party cookies**, which is right only when
 * there is no connected account at all. Once the SDK exists there are several distinct
 * reasons, they need different actions, and a message that names the wrong one sends someone
 * into browser settings for a problem a single press would fix. This is `docs/BUGS.md` B-6
 * in a new place: asserting a cause nobody verified.
 */
function previewReason(sdkFailed: string | null): string {
  switch (sdkFailed) {
    case "stale-scopes":
      return "Your Spotify connection was made before Timbre could play tracks, so it lacks permission to. Reconnect Spotify in Profile → Settings and this becomes the full song.";
    case "account_error":
      return "Full playback needs Spotify Premium — the Web Playback SDK does not serve free accounts. This is Spotify's own 30-second preview.";
    case "authentication_error":
      return "Spotify rejected the saved connection. Reconnect Spotify in Profile → Settings.";
    case "initialization_error":
      return "This browser cannot run Spotify's player, so this is their 30-second preview instead.";
    case "blocked":
      return "Spotify's player never started — an ad blocker or network filter is blocking spclient.spotify.com, which it needs. Allowing this site in your blocker fixes it.";
    case "refused":
      return "Spotify refused to start the track on this device, so this is their 30-second preview.";
    default:
      // No account connected. The embed reads a session through third-party cookies, and
      // that is genuinely what is missing here.
      return "";
  }
}

interface EmbedController {
  play(): void;
  pause(): void;
  resume(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  destroy(): void;
  addListener(event: string, handler: (payload: { data?: PlaybackData }) => void): void;
}

interface PlaybackData {
  isPaused: boolean;
  isBuffering: boolean;
  /** Milliseconds — 30 000-ish for a listener who is not signed in. */
  duration: number;
  position: number;
  playingURI?: string;
}

interface SpotifyIFrameApi {
  createController(
    element: HTMLElement,
    options: { uri: string; width: string | number; height: string | number },
    callback: (controller: EmbedController) => void,
  ): void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameApi) => void;
  }
}

let apiPromise: Promise<SpotifyIFrameApi> | null = null;

/** Loads the embed API once per page. Spotify hands the object to a global callback rather
 * than defining a namespace, so the promise has to be created before the script is added. */
function loadApi(): Promise<SpotifyIFrameApi> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<SpotifyIFrameApi>((resolve, reject) => {
    window.onSpotifyIframeApiReady = (api) => resolve(api);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    if (existing) return;
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.addEventListener("error", () => reject(new Error("Spotify embed API blocked.")));
    document.body.append(script);
  });

  // A rejection is not memoised. The script being blocked once — a flaky network, an
  // extension toggled mid-session — must not read as blocked for as long as the tab lives.
  apiPromise = apiPromise.catch((cause: unknown) => {
    apiPromise = null;
    throw cause;
  });
  return apiPromise;
}

export function SpotifyPlayer({
  trackId,
  size = "w-full",
}: {
  trackId: string | null;
  size?: string;
}) {
  const tokens = useSpotifyTokens();
  /**
   * The song the SDK last refused, and why.
   *
   * Stored **with its track id rather than cleared on change**: resetting per track in an
   * effect is the obvious move and is the one thing `react-hooks/set-state-in-effect`
   * forbids, so the refusal is scoped by derivation instead — it applies only while the song
   * it belongs to is the one on screen. A listener without Premium is therefore told once per
   * song rather than having one refusal disable the SDK for the session.
   */
  const [sdkFailure, setSdkFailure] = useState<{ trackId: string; reason: string } | null>(null);
  const sdkFailed = sdkFailure && sdkFailure.trackId === trackId ? sdkFailure.reason : null;
  const useSdk = Boolean(tokens) && !sdkFailed;

  const onSdkOutcome = useCallback(
    (outcome: SdkOutcome) => {
      if (outcome.kind === "unavailable" && trackId) {
        setSdkFailure({ trackId, reason: outcome.reason });
      }
    },
    [trackId],
  );
  const {
    current,
    handleEnded,
    handleStateChange,
    handleProgress,
    handleError,
    registerToggle,
    registerSeek,
  } = usePlayerControls();

  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  /** The embed reports `position: 0` both before it starts and after it ends, so "ended" is
   * inferred from having played and then come back to zero while paused. */
  const reachedEnd = useRef(false);

  /** Whether Spotify is serving a clip for a song we know is longer — see the note above. */
  const [previewOnly, setPreviewOnly] = useState(false);
  /** Through a ref: the `playback_update` listener is registered once and would otherwise
   * hold the first render's duration for the life of the controller. */
  const realDurationRef = useRef<number | null>(current?.durationMs ?? null);
  useEffect(() => {
    realDurationRef.current = current?.durationMs ?? null;
  }, [current?.durationMs]);

  useEffect(() => {
    const container = hostRef.current;
    if (!container || !trackId || useSdk) return;

    let cancelled = false;
    reachedEnd.current = false;

    /*
     * **A fresh child per track, never the ref'd node itself.**
     *
     * `createController` *replaces* the element it is given — measured: handing it a
     * pre-built `<iframe>` produced a Spotify-built one in its place. Passing `hostRef`
     * directly therefore worked once and then failed silently, because on the next track the
     * ref pointed at a node Spotify had already swapped out of the document. The symptom is
     * a Spotify track that shows the right title and duration and never starts, with no
     * iframe in the page at all.
     *
     * So the container stays React's, and each controller gets a disposable child inside it —
     * the same shape `soundcloud-player.tsx` uses for the same reason.
     */
    const host = document.createElement("div");
    container.replaceChildren(host);

    loadApi()
      .then((api) => {
        if (cancelled) return;
        api.createController(
          host,
          { uri: `spotify:track:${trackId}`, width: "100%", height: 152 },
          (controller) => {
            if (cancelled) {
              controller.destroy();
              return;
            }
            controllerRef.current = controller;

            controller.addListener("ready", () => {
              // Autoplay, which is the whole change. Browsers may still refuse it without a
              // gesture; the reader pressing Spotify's own button is then the fallback, and
              // it is the behaviour this file had before.
              controller.play();
            });

            controller.addListener("playback_update", (event) => {
              const data = event.data;
              if (!data) return;

              handlers.current.handleProgress(data.position / 1000, data.duration / 1000);

              // A clip is ~30s. Only claimed when the song is known to be meaningfully
              // longer, so a genuinely short track is never accused of being truncated.
              const real = realDurationRef.current;
              const clipped =
                data.duration > 0 && data.duration <= 31_000 && real !== null && real > 45_000;
              setPreviewOnly(clipped);
              // Remembered so the *next* Spotify press can open a first-party window, where
              // the same embed plays in full. See `spotify/preview-mode.ts` — a window needs
              // a user gesture, and there is none here, seconds after the press.
              if (clipped) rememberSpotifyPreviewsOnly();

              if (data.position > 0) reachedEnd.current = true;
              if (reachedEnd.current && data.isPaused && data.position === 0) {
                reachedEnd.current = false;
                handlers.current.handleEnded();
                return;
              }

              handlers.current.handleStateChange(
                data.isBuffering ? "loading" : data.isPaused ? "paused" : "playing",
              );
            });
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        handlers.current.handleError(
          "Couldn't load Spotify's player. An ad blocker or network filter may be blocking it.",
          false,
        );
      });

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      // Whatever Spotify left behind goes with it; the container is React's and survives.
      container.replaceChildren();
    };
  }, [trackId, useSdk]);

  const toggle = useCallback(() => controllerRef.current?.togglePlay(), []);
  const seek = useCallback((seconds: number) => controllerRef.current?.seek(seconds), []);

  // Registered rather than cleared: unlike before, this player *can* be driven, so Timbre's
  // own transport works on it.
  useEffect(() => {
    if (useSdk) return;
    registerToggle(toggle);
    return () => registerToggle(null);
  }, [useSdk, registerToggle, toggle]);

  useEffect(() => {
    if (useSdk) return;
    registerSeek(seek);
    return () => registerSeek(null);
  }, [useSdk, registerSeek, seek]);

  if (!trackId) return null;

  // The SDK draws nothing — Timbre's transport drives it — so when it owns the song this
  // renders the cover instead of an embed nobody would press.
  if (useSdk) {
    return (
      <div className={`flex items-center justify-center overflow-hidden bg-black ${size}`}>
        <SpotifySdkPlayer trackId={trackId} onOutcome={onSdkOutcome} />
        {current?.artworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.artworkUrl}
            alt=""
            aria-hidden
            className="max-h-full max-w-[260px] rounded-[var(--r-md)] object-contain"
          />
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center overflow-hidden bg-black ${size}`}>
      <div ref={hostRef} className="w-full" />
      {previewOnly && trackId && (
        /*
         * **The same embed, in a window of its own.**
         *
         * An iframe inside Timbre is third-party to `open.spotify.com`, so the browser will
         * not send the session cookie and Spotify's server decides `isAnonymous: true` before
         * any script runs. A **top-level** window on that origin is first-party, the cookie
         * goes, and the identical page plays the whole track — verified by opening
         * `open.spotify.com/embed/track/{id}` directly in a tab.
         *
         * So this is not a different player or a trick; it is the same document escaping the
         * frame. What it costs is control: nothing here can read its position or hear it end,
         * so the queue rests exactly as it did for the old manual panel. That is the whole
         * trade, and it is why this is an offer rather than the default.
         */
        <button
          type="button"
          onClick={() => openSpotifyWindow(trackId)}
          className="press slab-sm slab-soft mt-2 rounded-[var(--r-full)] bg-[var(--surface-1)] px-3 py-1 text-[11px] font-medium text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)]"
        >
          Play the full song in a Spotify window
        </button>
      )}
      {previewOnly && (
        // Not an error: playback is working, it is just short. Whatever the cause, the reader
        // is the only one who can act on it, so it is named exactly rather than vaguely.
        <p className="px-3 py-2 text-center text-[11px] leading-snug text-[var(--fg-faint)]">
          {previewReason(sdkFailed) || (
            <>
              Spotify is playing a 30-second preview — its embed reads your login through
              third-party cookies, which your browser blocks. To play in full, connect your
              Spotify account in{" "}
              <span className="text-[var(--fg-dim)]">Profile → Settings</span>. Needs Premium
              and a client id from your own Spotify app.
            </>
          )}
        </p>
      )}
    </div>
  );
}
