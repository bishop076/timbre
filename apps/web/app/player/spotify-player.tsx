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

const API_SRC = "https://open.spotify.com/embed/iframe-api/v1";

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

  const reachedEnd = useRef(false);

  const [previewOnly, setPreviewOnly] = useState(false);
  const realDurationRef = useRef<number | null>(current?.durationMs ?? null);
  useEffect(() => {
    realDurationRef.current = current?.durationMs ?? null;
  }, [current?.durationMs]);

  useEffect(() => {
    const container = hostRef.current;
    if (!container || !trackId || useSdk) return;

    let cancelled = false;
    reachedEnd.current = false;

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
              controller.play();
            });

            controller.addListener("playback_update", (event) => {
              const data = event.data;
              if (!data) return;

              handlers.current.handleProgress(data.position / 1000, data.duration / 1000);

              const real = realDurationRef.current;
              const clipped =
                data.duration > 0 && data.duration <= 31_000 && real !== null && real > 45_000;
              setPreviewOnly(clipped);
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
      container.replaceChildren();
    };
  }, [trackId, useSdk]);

  const toggle = useCallback(() => controllerRef.current?.togglePlay(), []);
  const seek = useCallback((seconds: number) => controllerRef.current?.seek(seconds), []);

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
        <button
          type="button"
          onClick={() => openSpotifyWindow(trackId)}
          className="press slab-sm slab-soft mt-2 rounded-[var(--r-full)] bg-[var(--surface-1)] px-3 py-1 text-[11px] font-medium text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)]"
        >
          Play the full song in a Spotify window
        </button>
      )}
      {previewOnly && (
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
