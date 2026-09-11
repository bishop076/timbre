"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { openSpotifyWindow, rememberSpotifyPreviewsOnly } from "../spotify/preview-mode.ts";
import { useSpotifyTokens } from "../spotify/token-store.ts";
import { addScript, blockedReason, findScript, loadOnce, useLatest, useTransport } from "./embed";
import { usePlayerControls } from "./player-context";

const SpotifySdkPlayer = dynamic(() =>
  import("./spotify-sdk-player").then((m) => m.SpotifySdkPlayer),
);

const API_SRC = "https://open.spotify.com/embed/iframe-api/v1";

const PREVIEW_REASONS: Record<string, string> = {
  "stale-scopes":
    "Your Spotify connection was made before Timbre could play tracks, so it lacks permission to. Reconnect Spotify in Profile → Settings and this becomes the full song.",
  account_error:
    "Full playback needs Spotify Premium — the Web Playback SDK does not serve free accounts. This is Spotify's own 30-second preview.",
  authentication_error:
    "Spotify rejected the saved connection. Reconnect Spotify in Profile → Settings.",
  initialization_error:
    "This browser cannot run Spotify's player, so this is their 30-second preview instead.",
  blocked:
    "Spotify's player never started — an ad blocker or network filter is blocking spclient.spotify.com, which it needs. Allowing this site in your blocker fixes it.",
  refused:
    "Spotify refused to start the track on this device, so this is their 30-second preview.",
};

interface EmbedController {
  play(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  destroy(): void;
  addListener(
    event: string,
    handler: (payload: {
      data?: { isPaused: boolean; isBuffering: boolean; duration: number; position: number };
    }) => void,
  ): void;
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

const loadApi = loadOnce<SpotifyIFrameApi>((resolve, reject) => {
  window.onSpotifyIframeApiReady = resolve;
  if (findScript(API_SRC)) return;
  const script = addScript(API_SRC, document.body);
  script.addEventListener("error", () => {
    script.remove();
    reject(new Error("Spotify embed API blocked."));
  });
});

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

  const controls = usePlayerControls();
  const live = useLatest(controls);

  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const [previewOnly, setPreviewOnly] = useState(false);

  useEffect(() => {
    const container = hostRef.current;
    if (!container || !trackId || useSdk) return;

    let cancelled = false;
    let reachedEnd = false;
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
            controller.addListener("ready", () => controller.play());

            controller.addListener("playback_update", ({ data }) => {
              if (!data) return;
              const { current: song, handleProgress, handleEnded, handleStateChange } =
                live.current;
              handleProgress(data.position / 1000, data.duration / 1000);

              const clipped =
                data.duration > 0 && data.duration <= 31_000 && (song?.durationMs ?? 0) > 45_000;
              setPreviewOnly(clipped);
              if (clipped) rememberSpotifyPreviewsOnly();

              if (data.position > 0) reachedEnd = true;
              if (reachedEnd && data.isPaused && data.position === 0) {
                reachedEnd = false;
                handleEnded();
                return;
              }
              handleStateChange(
                data.isBuffering ? "loading" : data.isPaused ? "paused" : "playing",
              );
            });
          },
        );
      })
      .catch(() => {
        if (!cancelled) live.current.handleError(blockedReason("Spotify"), false);
      });

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
      container.replaceChildren();
    };
  }, [live, trackId, useSdk]);

  useTransport(
    {
      toggle: () => controllerRef.current?.togglePlay(),
      seek: (seconds) => controllerRef.current?.seek(seconds),
    },
    !useSdk,
  );

  if (!trackId) return null;

  if (useSdk) {
    return (
      <div className={`flex items-center justify-center overflow-hidden bg-black ${size}`}>
        <SpotifySdkPlayer
          trackId={trackId}
          onOutcome={(outcome) => {
            if (outcome.kind === "unavailable") setSdkFailure({ trackId, reason: outcome.reason });
          }}
        />
        {controls.current?.artworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={controls.current.artworkUrl}
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
      {previewOnly && (
        <>
          <button
            type="button"
            onClick={() => openSpotifyWindow(trackId)}
            className="press slab-sm slab-soft mt-2 rounded-[var(--r-full)] bg-[var(--surface-1)] px-3 py-1 text-[11px] font-medium text-[var(--fg-dim)] transition-colors hover:text-[var(--fg)]"
          >
            Play the full song in a Spotify window
          </button>
          <p className="px-3 py-2 text-center text-[11px] leading-snug text-[var(--fg-faint)]">
            {(sdkFailed && PREVIEW_REASONS[sdkFailed]) || (
              <>
                Spotify is playing a 30-second preview — its embed reads your login through
                third-party cookies, which your browser blocks. To play in full, connect your
                Spotify account in{" "}
                <span className="text-[var(--fg-dim)]">Profile → Settings</span>. Needs Premium
                and a client id from your own Spotify app.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
