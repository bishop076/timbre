"use client";

/**
 * Starting and finishing the Spotify connection.
 *
 * The verifier and the state live in `sessionStorage` for the length of the round trip, not
 * `localStorage`: they are single-use, they belong to *this* tab, and leaving them behind
 * after the redirect gives a later page something to replay.
 */

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

/**
 * The app to authorise against.
 *
 * `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` is the deployment's own, and a value saved in the browser
 * overrides it — which matters because Spotify allows **five users per app**, so anyone
 * running their own copy needs their own client id, and asking them to rebuild to supply it
 * would be the whole barrier again in a smaller form. A client id is public by design; PKCE
 * exists precisely so that no secret accompanies it.
 */
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
    // Blocked storage. The connection simply cannot be started, which the caller reports.
  }
}

/** Must match a Redirect URI registered on the Spotify app, exactly. */
export function redirectUri(): string {
  return `${window.location.origin}/spotify/callback`;
}

/** Sends the reader to Spotify. Returns a reason when it cannot, rather than throwing. */
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

/**
 * Finishes the round trip. Returns a reason on failure, `null` on success.
 *
 * The state is compared before the code is spent — that is what the parameter is for, and
 * skipping it would let another site start a flow that lands in this tab.
 */
export async function completeConnect(params: URLSearchParams): Promise<string | null> {
  // Taken out of storage first, whatever the answer was: the round trip is over, and a
  // refusal must not leave a live verifier behind any more than a success would.
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

/**
 * A usable access token, refreshing first if the stored one has lapsed.
 *
 * Returns null rather than throwing on a refusal, and clears nothing: a refresh can fail
 * because the network is down, and dropping the connection for that would make the reader
 * sign in again for no reason. A token Spotify has actually revoked fails at the search,
 * which is where it is reported.
 */
export async function accessToken(): Promise<string | null> {
  const tokens: SpotifyTokens | null = getSpotifyTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens.accessToken;

  const clientId = spotifyClientId();
  const refreshToken = tokens.refreshToken;
  if (!clientId || !refreshToken) return null;

  // One refresh at a time. PKCE refresh tokens are single-use — Spotify rotates them — so
  // two callers finding the same lapsed token and each spending it meant the second was
  // refused with `invalid_grant` and reported the connection as off. The callers are not
  // hypothetical: the search fires per query, and the SDK asks on its own schedule.
  refreshing ??= refresh(clientId, refreshToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

let refreshing: Promise<string | null> | null = null;

async function refresh(clientId: string, refreshToken: string): Promise<string | null> {
  try {
    const next = await refreshTokens({ clientId, refreshToken });
    // Spotify may not reissue a refresh token; keeping the old one is what the spec expects.
    const merged = { ...next, refreshToken: next.refreshToken ?? refreshToken };
    saveSpotifyTokens(merged);
    return merged.accessToken;
  } catch {
    return null;
  }
}
