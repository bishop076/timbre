"use client";

import type { Song } from "../types";
import { accessToken } from "./connection.ts";

interface SpotifyTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  artists?: { name?: string }[];
  album?: { name?: string; images?: { url?: string }[] };
}

const REFUSALS: Record<number, string> = {
  401: "Spotify signed this browser out. Connect again.",
  403: "This Spotify app has not granted your account access. Development-mode apps allow five users.",
  429: "Spotify is rate-limiting this app. Try again shortly.",
};

function toSong(track: SpotifyTrack): Song | null {
  if (!track.id || !track.name) return null;
  const images = track.album?.images;

  return {
    id: `spotify:${track.id}`,
    title: track.name,
    artists: (track.artists ?? []).flatMap((artist) => artist.name || []),
    album: track.album?.name ?? null,
    durationMs: track.duration_ms ?? null,
    isrc: track.external_ids?.isrc ?? null,
    artworkUrl: (images?.[1] ?? images?.[0])?.url ?? null,
    sources: [
      {
        source: "spotify",
        sourceId: track.id,
        url: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
        playback: "manual",
      },
    ],
  };
}

export type SpotifySearchResult =
  | { kind: "off" }
  | { kind: "ok"; songs: Song[]; from: "catalogue" | "account" }
  | { kind: "error"; message: string };

export async function searchSpotifyCatalogue(query: string, signal?: AbortSignal): Promise<Song[]> {
  const response = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`, { signal });
  const body = (await response.json().catch(() => null)) as { songs?: Song[]; error?: string } | null;
  if (!response.ok || !body?.songs) throw new Error(body?.error ?? `Spotify search failed (${response.status}).`);
  return body.songs;
}

export async function searchSpotify(query: string, signal?: AbortSignal): Promise<SpotifySearchResult> {
  const token = await accessToken();
  if (!token) return { kind: "off" };

  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  let response: Response;
  try {
    response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return { kind: "error", message: "Could not reach Spotify." };
  }

  if (!response.ok) {
    const message = REFUSALS[response.status] ?? `Spotify answered ${response.status}.`;
    return { kind: "error", message };
  }

  const body = (await response.json()) as { tracks?: { items?: SpotifyTrack[] } };
  const songs = (body.tracks?.items ?? []).flatMap((track) => toSong(track) ?? []);
  return { kind: "ok", songs, from: "account" };
}
