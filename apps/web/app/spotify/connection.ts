"use client";

import { createLocalStore, readItem, useLocalStore, writeItem } from "../local-store.ts";
import {
  authorizeUrl,
  challengeFor,
  createVerifier,
  exchangeCode,
  refreshTokens,
  SpotifyAuthError,
} from "./pkce.ts";
import { disconnectSpotify, getSpotifyTokens, saveSpotifyTokens } from "./token-store.ts";

const VERIFIER_KEY = "timbre:spotify:verifier";
const STATE_KEY = "timbre:spotify:state";
const CLIENT_ID_KEY = "timbre:spotify:client-id";

/**
 * A failure the reader is meant to read: a headline they can recognise and a line telling them
 * whether anything they do will help. Every one of these is written here — none of it is ever a
 * string that came back from Spotify. See `SpotifyAuthError` and the `error` parameter below.
 */
export interface ConnectFailure {
  title: string;
  detail: string;
  /** True when starting the connect flow again is a sensible next move. */
  retry: boolean;
}

const STORAGE_BLOCKED: ConnectFailure = {
  title: "This browser is blocking session storage",
  detail:
    "The sign-in keeps its one-time secrets there and cannot run without it. Private-browsing modes and strict cookie settings are the usual cause; allowing storage for this site fixes it.",
  retry: false,
};

const REFUSED: ConnectFailure = {
  title: "Spotify refused the sign-in",
  detail: "It did not give a reason Timbre can turn into anything more useful. Try once more.",
  retry: true,
};

const NO_CLIENT_ID: ConnectFailure = {
  title: "No Spotify client id is set",
  detail:
    "Timbre signs in with your own Spotify app rather than one of its own. Register an app at developer.spotify.com and paste its client id below.",
  retry: false,
};

/**
 * OAuth 2 error codes from the token endpoint, each given a fixed sentence.
 *
 * `invalid_grant` is the interesting one, and it means two different things depending on which
 * grant was being redeemed: a spent or expired authorization code during connect (they are single
 * use and live about ten minutes), or a dead refresh token later on. Only the second is worth
 * throwing the stored connection away for, so `accessToken` handles that case rather than this
 * table.
 *
 * A `Map` for the same reason as `REDIRECT_FAILURES` below: the key is a string off the wire.
 * `post()` in pkce.ts throws `new SpotifyAuthError(data.error || ...)`, so whatever the token
 * endpoint puts in `error` is what reaches this lookup.
 */
const EXCHANGE_FAILURES = new Map<string, ConnectFailure>(
  Object.entries({
    network: {
      title: "Could not reach Spotify",
      detail:
        "The sign-in got as far as Spotify and back, but exchanging it for a token never left this machine. A VPN or a content blocker holding accounts.spotify.com is the usual cause.",
      retry: true,
    },
    invalid_grant: {
      title: "That sign-in expired before it finished",
      detail:
        "Spotify's one-time codes last about ten minutes and cannot be used twice. Nothing is wrong — start the connection again.",
      retry: true,
    },
    invalid_client: {
      title: "Spotify does not recognise that client id",
      detail:
        "Check it against the app on developer.spotify.com. The client id is the public one, not the client secret.",
      retry: false,
    },
    invalid_request: {
      title: "Spotify rejected the sign-in request",
      detail:
        "Most often the redirect URI: this browser's is shown in Settings, and the Spotify app has to list it exactly, character for character.",
      retry: false,
    },
  }),
);

/**
 * What Spotify sends back on the redirect when it will not issue a code at all.
 *
 * The `error` parameter is attacker-controllable — anyone can hand out a link to
 * `/spotify/callback?error=<anything>&state=…` — so it is looked up here and never rendered.
 * `completeConnect` checks `state` before it reaches this table, which is what stops a stranger's
 * link getting this far; the table is the second lock, and the reason the callback screen cannot
 * be made to display someone else's sentence.
 *
 * A `Map`, not an object literal. A plain object hands back an `Object.prototype` member for the
 * handful of keys that name one, so `REDIRECT_FAILURES[denied] ?? REFUSED` never fell back for
 * them: `?error=constructor` returned the `Object` constructor — not nullish — and the callback
 * rendered a refusal panel with no heading and no explanation at all, while `?error=banana` was
 * refused properly. `__proto__`, `toString`, `valueOf`, `hasOwnProperty` and `isPrototypeOf` did
 * the same. That is the same class of bug, and it is fixed at the table rather than at the reader so a
 * second reader cannot reintroduce it.
 */
const REDIRECT_FAILURES = new Map<string, ConnectFailure>(
  Object.entries({
    access_denied: {
      title: "Sign-in was cancelled",
      detail:
        "Nothing was connected and nothing was stored. Spotify search still works without an account; it just cannot play whole tracks.",
      retry: true,
    },
    invalid_scope: {
      title: "The Spotify app does not allow what Timbre asked for",
      detail:
        "Timbre requests streaming and playback permissions. An app with those turned off cannot grant them.",
      retry: false,
    },
    server_error: {
      title: "Spotify had a problem of its own",
      detail: "Nothing on this side went wrong. Trying again in a moment usually works.",
      retry: true,
    },
    temporarily_unavailable: {
      title: "Spotify is temporarily unavailable",
      detail: "Its sign-in service is refusing requests just now. Try again shortly.",
      retry: true,
    },
  }),
);

/**
 * Both of these are read off the browser, and both are rendered by a panel that Next renders on
 * the server first. Going through a store rather than reading `localStorage` and
 * `window.location` during render is what keeps the two passes agreeing: `getServerSnapshot`
 * answers for the server and for the hydrating render, and the real value arrives on the
 * re-render straight after. The plain functions below stay for the non-React callers.
 */
const clientIdStore = createLocalStore<string | null>({
  initial: null,
  read: () => readItem(CLIENT_ID_KEY)?.trim() || null,
  write: (value) => writeItem(CLIENT_ID_KEY, value),
  keys: [CLIENT_ID_KEY],
});

const redirectStore = createLocalStore<string>({
  initial: "",
  read: () => `${window.location.origin}/spotify/callback`,
});

export function spotifyClientId(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  return fromEnv || clientIdStore.getSnapshot();
}

export function useSpotifyClientId(): string | null {
  const stored = useLocalStore(clientIdStore);
  return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim() || stored;
}

/** Spotify's own ids are 32 hex characters; the range is loose so a format change is not a wall. */
export function looksLikeClientId(value: string): boolean {
  return /^[A-Za-z0-9]{16,64}$/.test(value.trim());
}

export function saveSpotifyClientId(clientId: string): void {
  clientIdStore.save(clientId.trim());
}

/** The value the Spotify app has to list, shown in the panel so it can be copied rather than typed. */
export function spotifyRedirectUri(): string {
  return typeof window === "undefined" ? "" : `${window.location.origin}/spotify/callback`;
}

export function useSpotifyRedirectUri(): string {
  return useLocalStore(redirectStore);
}

function writeSession(key: string, value: string | null): boolean {
  return writeItem(key, value, "sessionStorage");
}

export async function beginConnect(): Promise<ConnectFailure | null> {
  const clientId = spotifyClientId();
  if (!clientId) return NO_CLIENT_ID;
  if (!looksLikeClientId(clientId)) {
    return {
      title: "That does not look like a client id",
      detail:
        "A Spotify client id is one run of 32 letters and digits — no spaces, no dashes, no https://. Copy it from the app's dashboard page.",
      retry: false,
    };
  }

  const verifier = createVerifier();
  const state = createVerifier(32);
  if (!writeSession(VERIFIER_KEY, verifier) || !writeSession(STATE_KEY, state)) {
    return STORAGE_BLOCKED;
  }

  const challenge = await challengeFor(verifier);
  window.location.assign(
    authorizeUrl({ clientId, redirectUri: spotifyRedirectUri(), challenge, state }),
  );
  return null;
}

export async function completeConnect(params: URLSearchParams): Promise<ConnectFailure | null> {
  const verifier = readItem(VERIFIER_KEY, "sessionStorage");
  const expected = readItem(STATE_KEY, "sessionStorage");
  // Spent before anything is judged, so one redirect can only ever be redeemed once. A reload of
  // this URL, or a second tab handed the same link, finds nothing to check itself against.
  if (!writeSession(VERIFIER_KEY, null) || !writeSession(STATE_KEY, null)) return STORAGE_BLOCKED;

  if (!verifier || !expected) {
    return {
      title: "This sign-in was not started here",
      detail:
        "The one-time secret proving it belongs to this tab is missing — because the sign-in began in another tab or window, because this page was reloaded after it had already finished, or because the link came from somewhere else entirely. Start the connection again from Settings.",
      retry: true,
    };
  }
  if (params.get("state") !== expected) {
    return {
      title: "The sign-in came back with the wrong state",
      detail:
        "The value Spotify returned is not the one this tab sent, so the response was rejected and nothing was stored. That check is what stops someone else's sign-in being planted here.",
      retry: true,
    };
  }

  const denied = params.get("error");
  if (denied) return REDIRECT_FAILURES.get(denied) ?? REFUSED;

  const code = params.get("code");
  if (!code) {
    return {
      title: "Spotify did not send a code back",
      detail:
        "The redirect arrived carrying neither an authorization code nor an error, which leaves nothing to exchange. Start the connection again.",
      retry: true,
    };
  }

  const clientId = spotifyClientId();
  if (!clientId) return NO_CLIENT_ID;

  try {
    saveSpotifyTokens(
      await exchangeCode({ clientId, redirectUri: spotifyRedirectUri(), code, verifier }),
    );
    return null;
  } catch (cause) {
    if (cause instanceof SpotifyAuthError) return EXCHANGE_FAILURES.get(cause.code) ?? REFUSED;
    return REFUSED;
  }
}

let refreshing: Promise<string | null> | null = null;

export async function accessToken(): Promise<string | null> {
  const tokens = getSpotifyTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;

  const clientId = spotifyClientId();
  const { refreshToken } = tokens;
  if (!clientId || !refreshToken) return null;

  refreshing ??= refreshTokens({ clientId, refreshToken })
    .then((next) => {
      const merged = { ...next, refreshToken: next.refreshToken ?? refreshToken };
      saveSpotifyTokens(merged);
      return merged.accessToken;
    })
    .catch((cause: unknown) => {
      // A refresh token Spotify has rejected is dead for good — the password changed, or Timbre
      // was removed under Apps in the account. Keeping it made the panel say "Connected" for ever
      // over a connection that could never work again, while every player quietly dropped to a
      // 30-second preview and nothing anywhere said why. Any other failure is the network, and a
      // dropped connection is no reason to throw a working grant away.
      if (cause instanceof SpotifyAuthError && cause.code === "invalid_grant") {
        disconnectSpotify("lapsed");
      }
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
