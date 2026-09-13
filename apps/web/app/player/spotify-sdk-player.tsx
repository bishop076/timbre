"use client";

import { useEffect, useRef, useState } from "react";

import { log } from "../logs.ts";
import { accessToken } from "../spotify/connection.ts";
import { addScript, loadOnce, useLatest, useTransport } from "./embed";
import { usePlayerControls } from "./player-context";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

const READY_MS = 10_000;

// Starting the SDK is four steps — token, script, connect, device — and only the last one had
// a deadline, armed *after* the three awaits that precede it. `loadSdk` settles on
// `onSpotifyWebPlaybackSDKReady` or the script tag's `error` event, so an `sdk.scdn.co` that
// accepts the connection and then stalls settles it neither way: the line arming the timer was
// never reached, `onOutcome` never fired, the embed fallback never rendered, and the track sat
// on a spinning play button for ever. `loadOnce` caches that pending promise for the session,
// so every later Spotify track did the same thing. This bounds the three steps the READY timer
// cannot see, on the same 8s the other embeds treat as "something is blocking this".
const HANDSHAKE_MS = 8000;

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

const loadSdk = loadOnce<void>((resolve, reject) => {
  if (window.Spotify?.Player) return resolve();
  window.onSpotifyWebPlaybackSDKReady = () => resolve();
  addScript(SDK_SRC, document.body).addEventListener("error", () =>
    reject(new Error("Spotify SDK blocked.")),
  );
});

type SdkOutcome = { kind: "playing" } | { kind: "unavailable"; reason: string };

export function SpotifySdkPlayer({
  trackId,
  onOutcome,
}: {
  trackId: string;
  onOutcome: (outcome: SdkOutcome) => void;
}) {
  const controls = usePlayerControls();
  const level = controls.muted ? 0 : controls.volume;

  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const deviceRef = useRef<string | null>(null);
  const started = useRef(false);
  const [ready, setReady] = useState(false);

  const live = useLatest({ ...controls, onOutcome });

  useEffect(() => {
    let cancelled = false;
    let player: SpotifyPlayerInstance | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const unavailable = (reason: string) => {
      if (!cancelled) live.current.onOutcome({ kind: "unavailable", reason });
    };

    // Armed before the first await, and cleared the moment `connect()` answers. "blocked" is
    // the right reason for all three steps it covers: a stalled token refresh, a script that
    // never runs and a `connect()` that never returns all read as a filter in the way.
    const handshakeTimer = setTimeout(() => {
      log("error", "Spotify SDK: nothing answered within 8s of starting — treating it as blocked.");
      unavailable("blocked");
    }, HANDSHAKE_MS);

    (async () => {
      const token = await accessToken();
      if (!token) {
        clearTimeout(handshakeTimer);
        log("warn", "Spotify SDK: no usable token — not connected, or the refresh failed.");
        unavailable("not-connected");
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
          unavailable(failure);
        }) as never);
      }

      player.addListener("player_state_changed", ((state: PlayerState | null) => {
        if (!state) return;
        const { handleProgress, handleEnded, handleStateChange } = live.current;
        handleProgress(state.position / 1000, state.duration / 1000);
        if (!state.paused) started.current = true;
        if (started.current && state.paused && state.position === 0) {
          started.current = false;
          handleEnded();
          return;
        }
        handleStateChange(state.paused ? "paused" : "playing");
      }) as never);

      player.addListener("ready", (({ device_id }: { device_id: string }) => {
        clearTimeout(readyTimer);
        log("info", `Spotify SDK: device registered (${device_id.slice(0, 8)}…).`);
        deviceRef.current = device_id;
        setReady(true);
      }) as never);

      // Cleanup sets `cancelled` before it calls `disconnect()`, so the `not_ready` that a
      // normal teardown provokes is ignored and only a device that drops mid-song gets here.
      // Without this the device id stayed valid, the play effect had no reason to re-run and
      // no outcome was reported: audio stopped, state stayed `playing`, progress froze and the
      // ladder never walked.
      player.addListener("not_ready", (() => {
        log("warn", "Spotify SDK: the device went offline.");
        if (cancelled || !deviceRef.current) return;
        deviceRef.current = null;
        setReady(false);
        unavailable("device-offline");
      }) as never);

      const connected = await player.connect();
      clearTimeout(handshakeTimer);
      log(connected ? "info" : "error", `Spotify SDK: connect() returned ${connected}.`);
      if (cancelled) return;

      readyTimer = setTimeout(() => {
        if (deviceRef.current) return;
        log(
          "error",
          "Spotify SDK: no device after 10s — spclient.spotify.com is usually the cause, and an ad blocker is usually why.",
        );
        unavailable("blocked");
      }, READY_MS);
    })().catch((cause: unknown) => {
      clearTimeout(handshakeTimer);
      if (cancelled) return;
      log("error", `Spotify SDK failed to start: ${cause instanceof Error ? cause.message : String(cause)}`);
      unavailable("sdk-failed");
    });

    return () => {
      cancelled = true;
      clearTimeout(handshakeTimer);
      clearTimeout(readyTimer);
      player?.disconnect();
      playerRef.current = null;
      deviceRef.current = null;
    };
  }, [live]);

  useEffect(() => {
    const device = deviceRef.current;
    if (!ready || !device) return;
    let cancelled = false;

    (async () => {
      const token = await accessToken();
      if (!token || cancelled) return;
      const response = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(device)}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
        },
      );
      if (cancelled) return;
      if (response.ok) {
        log("info", `Spotify SDK: playing ${trackId} on this device.`);
        started.current = false;
        live.current.onOutcome({ kind: "playing" });
        return;
      }
      const detail = await response.text().catch(() => "");
      log("error", `Spotify SDK: play refused (${response.status}) ${detail.slice(0, 160)}`);
      live.current.onOutcome({
        kind: "unavailable",
        reason: response.status === 401 ? "stale-scopes" : "refused",
      });
    })().catch(() => {
      if (!cancelled) live.current.onOutcome({ kind: "unavailable", reason: "refused" });
    });

    return () => {
      cancelled = true;
    };
  }, [live, ready, trackId]);

  useEffect(() => {
    void playerRef.current?.setVolume(Math.max(0, Math.min(1, level / 100)));
  }, [level]);

  useTransport(
    {
      toggle: () => void playerRef.current?.togglePlay(),
      seek: (seconds) => void playerRef.current?.seek(seconds * 1000),
    },
    ready,
  );

  return null;
}
