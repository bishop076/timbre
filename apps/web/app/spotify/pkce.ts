/**
 * Authorization Code with PKCE, run entirely in the browser.
 *
 * **Why this exists at all.** Spotify's catalogue cannot be searched without credentials,
 * and since 9 March 2026 a developer app needs the owner to hold Premium, allows five test
 * users, and grants extended quota only to a registered business with 250k monthly actives.
 * So Timbre cannot ship a key — but the reader can authorise Timbre with their own account,
 * and then the search runs on their quota, for their own listening.
 *
 * **Nothing here touches Timbre's server, and that is deliberate rather than incidental.**
 * PKCE needs no client secret, and both endpoints answer the browser directly — measured
 * 2026-08-20, `accounts.spotify.com/api/token` preflights `204` and
 * `api.spotify.com/v1/search` answers with `access-control-allow-origin` echoing the page's
 * origin. So the token lives in the reader's browser and is never seen by, sent to, or
 * stored on whatever host serves the app. That matches the rest of Timbre, which keeps no
 * server-side data about anyone.
 */

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";

/**
 * Read-only, and the narrowest that answers a search: none at all.
 *
 * Deliberately not `user-read-private`, `user-library-read` or anything about playback. The
 * only thing being asked for is the right to look things up in the catalogue, and a scope
 * that is never used is a permission the reader granted for nothing.
 */
export const SCOPES = "";

/** The unreserved set RFC 7636 specifies. */
const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** RFC 7636 allows 43-128; 64 sits comfortably inside it. */
const VERIFIER_LENGTH = 64;

/** Base64 as a URL wants it: no padding, and the two substitutions. */
function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh code verifier, from the platform CSPRNG rather than `Math.random`. */
export function createVerifier(length = VERIFIER_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Modulo bias over a 64-character alphabet and 256 byte values is exactly zero: 256 = 4x64.
  return Array.from(bytes, (byte) => VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length]).join("");
}

/** The S256 challenge for a verifier. The RFC also allows `plain`; it is not used here. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(digest);
}

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}

/** Where to send the reader to say yes. */
export function authorizeUrl({ clientId, redirectUri, challenge, state }: AuthorizeRequest): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  if (SCOPES) params.set("scope", SCOPES);
  return `${AUTHORIZE}?${params}`;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** A minute of slack, so a token is never spent in the instant before it lapses. */
const EXPIRY_MARGIN_MS = 60_000;

async function post(body: URLSearchParams): Promise<SpotifyTokens> {
  const response = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await response.json()) as TokenResponse;
  if (!response.ok || !data.access_token) {
    // Spotify's own words, which are specific and worth surfacing: `invalid_client` means
    // the client id is wrong, `invalid_grant` that the code was already spent or that the
    // redirect URI does not match the one registered on the app.
    throw new Error(data.error_description || data.error || `Spotify answered ${response.status}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
  };
}

/** Trades the code the redirect carried for a token. No secret - that is the point of PKCE. */
export function exchangeCode(options: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<SpotifyTokens> {
  return post(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      code_verifier: options.verifier,
    }),
  );
}

/** An access token lasts an hour; this is what keeps a connection from needing re-consent. */
export function refreshTokens(options: {
  clientId: string;
  refreshToken: string;
}): Promise<SpotifyTokens> {
  return post(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      client_id: options.clientId,
    }),
  );
}
