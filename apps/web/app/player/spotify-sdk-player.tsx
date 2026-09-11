"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { log } from "../logs.ts";
import { accessToken } from "../spotify/connection.ts";
import { usePlayerControls } from "./player-context";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

const READY_MS = 10_000;

interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, handler: (payload: never) => void): boolean;
  togglePlay(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(level: number): Promise<void>;
}

interface PlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window?: { current_track?: { id?: string } };
}

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayerInstance;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    if (window.Spotify?.Player) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.addEventListener("error", () => reject(new Error("Spotify SDK blocked.")));
    document.body.append(script);
  });
  sdkPromise = sdkPromise.catch((cause: unknown) => {
    sdkPromise = null;
    throw cause;
  });
  return sdkPromise;
}

async function playOnDevice(deviceId: string, trackId: string, token: string): Promise<Response> {
  return fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
}

export type SdkOutcome =
  | { kind: "playing" }
  | { kind: "unavailable"; reason: string };

export function SpotifySdkPlayer({
  trackId,
  onOutcome,
}: {
  trackId: string;
  onOutcome: (outcome: SdkOutcome) => void;
}) {
  const { volume, muted, handleEnded, handleStateChange, handleProgress, registerToggle, registerSeek } =
    usePlayerControls();

  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const deviceRef = useRef<string | null>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, onOutcome });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, onOutcome };
  }, [handleEnded, handleStateChange, handleProgress, onOutcome]);

  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let player: SpotifyPlayerInstance | null = null;

    (async () => {
      const token = await accessToken();
      if (!token) {
        log("warn", "Spotify SDK: no usable token — not connected, or the refresh failed.");
        handlers.current.onOutcome({ kind: "unavailable", reason: "not-connected" });
        return;
      }

      log("info", "Spotify SDK: token in hand, loading the player.");
      await loadSdk();
      if (cancelled || !window.Spotify) return;

      player = new window.Spotify.Player({
        name: "Timbre",
        getOAuthToken: (cb) => {
          void accessToken().then((fresh) => fresh && cb(fresh));
        },
        volume: 0.8,
      });
      playerRef.current = player;

      for (const failure of ["initialization_error", "authentication_error", "account_error", "playback_error"]) {
        player.addListener(failure, ((event: { message?: string }) => {
          log("error", `Spotify SDK ${failure}: ${event?.message ?? "no message"}`);
          handlers.current.onOutcome({ kind: "unavailable", reason: failure });
        }) as never);
      }

      player.addListener("player_state_changed", ((state: PlayerState | null) => {
        if (!state) return;
        handlers.current.handleProgress(state.position / 1000, state.duration / 1000);
        if (!state.paused) started.current = true;
        if (started.current && state.paused && state.position === 0) {
          started.current = false;
          handlers.current.handleEnded();
          return;
        }
        handlers.current.handleStateChange(state.paused ? "paused" : "playing");
      }) as never);

      player.addListener("ready", (({ device_id }: { device_id: string }) => {
        if (readyTimer.current) clearTimeout(readyTimer.current);
        log("info", `Spotify SDK: device registered (${device_id.slice(0, 8)}…).`);
        deviceRef.current = device_id;
        setReady(true);
      }) as never);

      player.addListener("not_ready", ((() => {
        log("warn", "Spotify SDK: the device went offline.");
      }) as never));

      const connected = await player.connect();
      log(connected ? "info" : "error", `Spotify SDK: connect() returned ${connected}.`);

      readyTimer.current = setTimeout(() => {
        if (deviceRef.current) return;
        log(
          "error",
          "Spotify SDK: no device after 10s — spclient.spotify.com is usually the cause, and an ad blocker is usually why.",
        );
        handlers.current.onOutcome({ kind: "unavailable", reason: "blocked" });
      }, READY_MS);
    })().catch((cause: unknown) => {
      if (cancelled) return;
      log("error", `Spotify SDK failed to start: ${cause instanceof Error ? cause.message : String(cause)}`);
      handlers.current.onOutcome({ kind: "unavailable", reason: "sdk-failed" });
    });

    return () => {
      cancelled = true;
      if (readyTimer.current) clearTimeout(readyTimer.current);
      readyTimer.current = null;
      player?.disconnect();
      playerRef.current = null;
      deviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const device = deviceRef.current;
    if (!ready || !device) return;
    let cancelled = false;

    (async () => {
      const token = await accessToken();
      if (!token || cancelled) return;
      const response = await playOnDevice(device, trackId, token);
      if (cancelled) return;
      if (response.ok) {
        log("info", `Spotify SDK: playing ${trackId} on this device.`);
        started.current = false;
        handlers.current.onOutcome({ kind: "playing" });
        return;
      }
      const detail = await response.text().catch(() => "");
      log("error", `Spotify SDK: play refused (${response.status}) ${detail.slice(0, 160)}`);
      handlers.current.onOutcome({
        kind: "unavailable",
        reason: response.status === 401 ? "stale-scopes" : "refused",
      });
    })().catch(() => {
      if (!cancelled) handlers.current.onOutcome({ kind: "unavailable", reason: "refused" });
    });

    return () => {
      cancelled = true;
    };
  }, [ready, trackId]);

  const level = muted ? 0 : volume;
  useEffect(() => {
    void playerRef.current?.setVolume(Math.max(0, Math.min(1, level / 100)));
  }, [level]);

  const toggle = useCallback(() => void playerRef.current?.togglePlay(), []);
  const seek = useCallback((seconds: number) => void playerRef.current?.seek(seconds * 1000), []);

  useEffect(() => {
    if (!ready) return;
    registerToggle(toggle);
    return () => registerToggle(null);
  }, [ready, registerToggle, toggle]);

  useEffect(() => {
    if (!ready) return;
    registerSeek(seek);
    return () => registerSeek(null);
  }, [ready, registerSeek, seek]);

  return null;
}
