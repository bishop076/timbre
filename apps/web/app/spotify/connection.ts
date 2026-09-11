"use client";

import {
  authorizeUrl,
  challengeFor,
  createVerifier,
  exchangeCode,
  refreshTokens,
  type SpotifyTokens,
} from "./pkce.ts";
import { getSpotifyTokens, saveSpotifyTokens } from "./token-store.ts";

const VERIFIER_KEY = "timbre:spotify:verifier";
const STATE_KEY = "timbre:spotify:state";
const CLIENT_ID_KEY = "timbre:spotify:client-id";

export function spotifyClientId(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    return window.localStorage.getItem(CLIENT_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function saveSpotifyClientId(clientId: string): void {
  try {
    const trimmed = clientId.trim();
    if (trimmed) window.localStorage.setItem(CLIENT_ID_KEY, trimmed);
    else window.localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
  }
}

export function redirectUri(): string {
  return `${window.location.origin}/spotify/callback`;
}

export async function beginConnect(): Promise<string | null> {
  const clientId = spotifyClientId();
  if (!clientId) return "No Spotify client id is set.";

  const verifier = createVerifier();
  const state = createVerifier(32);
  try {
    window.sessionStorage.setItem(VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(STATE_KEY, state);
  } catch {
    return "This browser is blocking session storage, so the sign-in cannot be completed.";
  }

  window.location.assign(
    authorizeUrl({ clientId, redirectUri: redirectUri(), challenge: await challengeFor(verifier), state }),
  );
  return null;
}

export async function completeConnect(params: URLSearchParams): Promise<string | null> {
  let verifier: string | null = null;
  let expected: string | null = null;
  try {
    verifier = window.sessionStorage.getItem(VERIFIER_KEY);
    expected = window.sessionStorage.getItem(STATE_KEY);
    window.sessionStorage.removeItem(VERIFIER_KEY);
    window.sessionStorage.removeItem(STATE_KEY);
  } catch {
    return "This browser is blocking session storage, so the sign-in cannot be completed.";
  }

  const denied = params.get("error");
  if (denied) return denied === "access_denied" ? "Sign-in was cancelled." : denied;

  const code = params.get("code");
  if (!code) return "Spotify did not send a code back.";

  if (!verifier || !expected) return "This sign-in was started in a different tab.";
  if (params.get("state") !== expected) return "The sign-in came back with the wrong state.";

  const clientId = spotifyClientId();
  if (!clientId) return "No Spotify client id is set.";

  try {
    saveSpotifyTokens(await exchangeCode({ clientId, redirectUri: redirectUri(), code, verifier }));
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Spotify refused the sign-in.";
  }
}

export async function accessToken(): Promise<string | null> {
  const tokens: SpotifyTokens | null = getSpotifyTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;

  const clientId = spotifyClientId();
  const refreshToken = tokens.refreshToken;
  if (!clientId || !refreshToken) return null;

  refreshing ??= refresh(clientId, refreshToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

let refreshing: Promise<string | null> | null = null;

async function refresh(clientId: string, refreshToken: string): Promise<string | null> {
  try {
    const next = await refreshTokens({ clientId, refreshToken });
    const merged = { ...next, refreshToken: next.refreshToken ?? refreshToken };
    saveSpotifyTokens(merged);
    return merged.accessToken;
  } catch {
    return null;
  }
}
