"use client";

/**
 * Spotify's **Web Playback SDK** — the only route to a full-length Spotify track in this app.
 *
 * ## Why this exists, when there is already an embed
 *
 * `spotify-player.tsx` embeds Spotify's own iframe player, and it will only ever play thirty
 * seconds here. Measured 2026-08-20 and traced to the mechanism: the embed page
 * server-renders its auth state — `isAnonymous: true`, plus an anonymous `accessToken` — into
 * `__NEXT_DATA__` **before any script runs**, decided from the cookies on that iframe
 * request. Chrome blocks third-party cookies by default, so no session is visible and the
 * decision is made before Timbre's page has any contact with the document.
 *
 * Nothing client-side can change that, and the two APIs that could grant the cookie are both
 * closed: `requestStorageAccessFor()` is Related Website Sets only, and Spotify's embed does
 * not implement the Storage Access API at all — 1 751 KB of its bundles contain zero
 * references to it.
 *
 * **This SDK does not use cookies.** It runs first-party in Timbre's own page and
 * authenticates with a bearer token, so the entire problem is absent by construction rather
 * than worked around.
 *
 * ## What it costs, none of which is hidden from the reader
 *
 * - **A registered Spotify app**, whose client id the reader supplies — see
 *   `spotify/connection.ts`. Five users per app, which is why a self-hoster can enter their
 *   own rather than rebuild.
 * - **Premium, on the listener's account.** Spotify's documentation: *"The Web Playback SDK
 *   requires a Spotify Premium subscription (mobile only types of premium subscriptions are
 *   excluded)."* A free account gets `account_error` and falls back to the embed.
 * - **Non-commercial only.** *"This SDK must not be used in commercial projects without
 *   Spotify's prior written approval."* That is compatible with where Timbre is, and it
 *   hard-binds `EXPOSURE.md` E-1's open question about donations.
 *
 * ## The terms position, stated rather than buried
 *
 * This plays Spotify's audio **through Timbre's own transport**, in a queue alongside YouTube
 * and SoundCloud. `BLOCKED.md` argues the embed panel stayed clear of Developer Terms §IV.2
 * precisely by *not* doing that. This is the closest thing in the project to the blending
 * that clause concerns, and it is a deliberate choice by whoever supplies a client id — not
 * something that happens to a reader who does nothing. With no client id and no token,
 * nothing here loads and the embed behaves exactly as before.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { log } from "../logs.ts";
import { accessToken } from "../spotify/connection.ts";
import { usePlayerControls } from "./player-context";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

/**
 * How long the SDK gets to register a device before the embed takes the song back.
 *
 * **Every other player here has this guard and this one did not.** `youtube-player.tsx`,
 * `mixcloud-player.tsx` and `soundcloud-player.tsx` all arm a timeout for the case where a
 * blocker stops the script arriving, because the failure is silence rather than an error.
 * The SDK has a worse version of the same problem: the script can load fine and the device
 * still never appears, because the SDK talks to `spclient.spotify.com` — which uBlock-class
 * lists block by default, seen as `ERR_BLOCKED_BY_CLIENT` on `/gabo-receiver-service` and
 * `/public/v3/events`.
 *
 * Without this, that combination hung: no `ready`, no error listener firing, no outcome
 * reported, and the reader left on a dead panel with the embed never taking over. Ten
 * seconds is longer than a cold SDK needs and short enough to stay inside loading.
 */
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

/** Loads the SDK once per page. Like Spotify's embed API it announces itself through a
 * global callback, so the promise has to exist before the script is added. */
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
  // A rejection is not memoised. The script being blocked once — a flaky network, an
  // extension toggled mid-session — must not read as blocked for as long as the tab lives.
  sdkPromise = sdkPromise.catch((cause: unknown) => {
    sdkPromise = null;
    throw cause;
  });
  return sdkPromise;
}

/** Puts a named track on the device the SDK registered. The SDK creates a device but cannot
 * choose what plays on it — that is a Web API call, and the reason `user-modify-playback-state`
 * is in `SCOPES`. */
async function playOnDevice(deviceId: string, trackId: string, token: string): Promise<Response> {
  return fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
  });
}

export type SdkOutcome =
  | { kind: "playing" }
  /** Premium is missing, the scopes are stale, or the SDK refused. The caller falls back to
   * the embed rather than leaving the reader with nothing. */
  | { kind: "unavailable"; reason: string };

export function SpotifySdkPlayer({
  trackId,
  onOutcome,
}: {
  trackId: string;
  /** Reports whether this took the song, so the caller can show the embed instead. */
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

  /** `player_state_changed` reports `paused: true, position: 0` on a finished track, and the
   * same on one that has not started, so ending is inferred from having played first. */
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

      // Every one of these means "the SDK cannot serve this listener", and each falls back to
      // the embed rather than stranding the song. `account_error` is the Premium case.
      for (const failure of ["initialization_error", "authentication_error", "account_error", "playback_error"]) {
        player.addListener(failure, ((event: { message?: string }) => {
          // The message is the useful half — `account_error` alone does not say "not
          // Premium", and Spotify puts that in the text.
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

      // Armed after connect, cleared by `ready`. See READY_MS: a blocked `spclient` produces
      // no event at all, so only a clock notices.
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

  // Starting the track is separate from creating the device: the device outlives track
  // changes, so only this effect re-runs when the song does.
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
      // The body carries Spotify's own reason — "Player command failed: Premium required",
      // "Invalid token scopes" and so on. Worth more than the status alone.
      const detail = await response.text().catch(() => "");
      log("error", `Spotify SDK: play refused (${response.status}) ${detail.slice(0, 160)}`);
      // 403 is the usual shape of "this account is not Premium"; 401 means the token predates
      // the playback scopes, which is the reconnect case.
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

  // Nothing to draw: the SDK has no UI of its own, which is the point — Timbre's transport
  // drives it. The caller renders the artwork.
  return null;
}
