"use client";

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

function cover(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  return (images[1] ?? images[0])?.url ?? null;
}

function toSong(track: SpotifyTrack): Song | null {
  if (!track.id || !track.name) return null;

  return {
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
