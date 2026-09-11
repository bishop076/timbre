"use client";

/**
 * Searching Spotify's catalogue — through Timbre's server with no account, or with the
 * reader's own token from the browser when that path is down.
 *
 * **Kept apart from `searchAll` on purpose, twice over.** Technically, the token lives in
 * this browser and the fan-out runs on the server, so it could not join it without sending
 * a credential somewhere it does not belong. And by the terms: Developer Terms IV.2 forbid
 * blending Spotify content with another service's, so these results are rendered as their
 * own attributed section rather than merged into the ranked list, and a Spotify entry stays
 * `playback: "manual"` — Spotify's own embed, which the reader presses.
 */

import type { Song } from "../types";
import { accessToken } from "./connection.ts";

const SEARCH = "https://api.spotify.com/v1/search";

interface SpotifyImage {
  url?: string;
  width?: number;
}

interface SpotifyTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  artists?: { name?: string }[];
  album?: { name?: string; images?: SpotifyImage[] };
}

/** Their covers come widest-first; the second is usually 300px, which is what a row needs. */
function cover(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  return (images[1] ?? images[0])?.url ?? null;
}

function toSong(track: SpotifyTrack): Song | null {
  if (!track.id || !track.name) return null;

  return {
    // Namespaced so it can never collide with a merged song's id, which is an ISRC or a
    // dedupe key. Two lists render side by side and React keys must not meet.
    id: `spotify:${track.id}`,
    title: track.name,
    artists: (track.artists ?? []).map((artist) => artist.name).filter((name): name is string => Boolean(name)),
    album: track.album?.name ?? null,
    durationMs: track.duration_ms ?? null,
    isrc: track.external_ids?.isrc ?? null,
    artworkUrl: cover(track.album?.images),
    sources: [
      {
        source: "spotify",
        sourceId: track.id,
        url: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
        // Never `queue`: the embed exposes no play API, and that is what keeps this clear
        // of IV.2 rather than a limitation to work around.
        playback: "manual",
      },
    ],
  };
}

export type SpotifySearchResult =
  | { kind: "off" }
  /** `from` says whose search answered — Spotify's public catalogue, or the reader's account. */
  | { kind: "ok"; songs: Song[]; from: "catalogue" | "account" }
  | { kind: "error"; message: string };

/**
 * Spotify's public catalogue, searched by Timbre's server with no account at all — see
 * `packages/providers/src/spotify-web.ts`. Throws on failure rather than returning an error,
 * so the caller can fall back to the reader's own account before giving up.
 */
export async function searchSpotifyCatalogue(query: string, signal?: AbortSignal): Promise<Song[]> {
  const response = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`, { signal });
  const body = (await response.json().catch(() => null)) as { songs?: Song[]; error?: string } | null;
  if (!response.ok || !body?.songs) throw new Error(body?.error ?? `Spotify search failed (${response.status}).`);
  return body.songs;
}

/**
 * Searches, or explains why it did not.
 *
 * `off` rather than an empty list when there is no connection, so the caller can render
 * nothing at all instead of an empty section that looks like a failure.
 */
export async function searchSpotify(query: string, signal?: AbortSignal): Promise<SpotifySearchResult> {
  const token = await accessToken();
  if (!token) return { kind: "off" };

  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  let response: Response;
  try {
    response = await fetch(`${SEARCH}?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return { kind: "error", message: "Could not reach Spotify." };
  }

  if (response.status === 401) {
    return { kind: "error", message: "Spotify signed this browser out. Connect again." };
  }
  if (response.status === 403) {
    // The five-user cap answers here, and the message matters: nothing the reader types
    // will fix it, and without saying so it reads as a bug in Timbre.
    return {
      kind: "error",
      message: "This Spotify app has not granted your account access. Development-mode apps allow five users.",
    };
  }
  if (response.status === 429) {
    return { kind: "error", message: "Spotify is rate-limiting this app. Try again shortly." };
  }
  if (!response.ok) return { kind: "error", message: `Spotify answered ${response.status}.` };

  const body = (await response.json()) as { tracks?: { items?: SpotifyTrack[] } };
  const songs = (body.tracks?.items ?? []).map(toSong).filter((song): song is Song => song !== null);
  return { kind: "ok", songs, from: "account" };
}
