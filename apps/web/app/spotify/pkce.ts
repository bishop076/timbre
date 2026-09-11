const SCOPES = "streaming user-read-email user-read-private user-modify-playback-state";

const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function createVerifier(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length]).join("");
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function authorizeUrl(request: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: request.clientId,
    response_type: "code",
    redirect_uri: request.redirectUri,
    code_challenge_method: "S256",
    code_challenge: request.challenge,
    state: request.state,
    scope: SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

async function post(body: Record<string, string>): Promise<SpotifyTokens> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Spotify answered ${response.status}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
}

export function exchangeCode(options: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<SpotifyTokens> {
  return post({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    code_verifier: options.verifier,
  });
}

export function refreshTokens(options: {
  clientId: string;
  refreshToken: string;
}): Promise<SpotifyTokens> {
  return post({
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: options.clientId,
  });
}
