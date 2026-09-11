"use client";

import { readItem, writeItem } from "../local-store.ts";
import { authorizeUrl, challengeFor, createVerifier, exchangeCode, refreshTokens } from "./pkce.ts";
import { getSpotifyTokens, saveSpotifyTokens } from "./token-store.ts";

const VERIFIER_KEY = "timbre:spotify:verifier";
const STATE_KEY = "timbre:spotify:state";
const CLIENT_ID_KEY = "timbre:spotify:client-id";
const STORAGE_BLOCKED =
  "This browser is blocking session storage, so the sign-in cannot be completed.";

export function spotifyClientId(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  return fromEnv || readItem(CLIENT_ID_KEY)?.trim() || null;
}

export function saveSpotifyClientId(clientId: string): void {
  writeItem(CLIENT_ID_KEY, clientId);
}

function writeSession(key: string, value: string | null): boolean {
  return writeItem(key, value, "sessionStorage");
}

function redirectUri(): string {
  return `${window.location.origin}/spotify/callback`;
}

export async function beginConnect(): Promise<string | null> {
  const clientId = spotifyClientId();
  if (!clientId) return "No Spotify client id is set.";

  const verifier = createVerifier();
  const state = createVerifier(32);
  if (!writeSession(VERIFIER_KEY, verifier) || !writeSession(STATE_KEY, state)) {
    return STORAGE_BLOCKED;
  }

  const challenge = await challengeFor(verifier);
  window.location.assign(authorizeUrl({ clientId, redirectUri: redirectUri(), challenge, state }));
  return null;
}

export async function completeConnect(params: URLSearchParams): Promise<string | null> {
  const verifier = readItem(VERIFIER_KEY, "sessionStorage");
  const expected = readItem(STATE_KEY, "sessionStorage");
  if (!writeSession(VERIFIER_KEY, null) || !writeSession(STATE_KEY, null)) return STORAGE_BLOCKED;

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
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
