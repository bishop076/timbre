import { ProviderError } from "@timbre/core";

import type { RadioSeed, RankedList, SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createHostPool, type HostPool } from "./host-pool.ts";
import { createRequester } from "./request.ts";

export const AUDIUS_HOSTS = [
  "https://api.audius.co",
  "https://discoveryprovider.audius.co",
  "https://discoveryprovider2.audius.co",
  "https://discoveryprovider3.audius.co",
] as const;

const COOL_DOWN_MS = 60_000;

const WEB = "https://audius.co";

interface AudiusArtwork {
  "150x150"?: string;
  "480x480"?: string;
  "1000x1000"?: string;
  mirrors?: string[];
}

interface AudiusTrack {
  id: string;
  title: string;
  duration?: number;
  permalink?: string;
  artwork?: AudiusArtwork | null;
  user?: { name?: string; handle?: string };
  isrc?: string | null;
  genre?: string | null;
  is_streamable?: boolean;
  is_available?: boolean;
  is_delete?: boolean;
  is_unlisted?: boolean;
  stream_conditions?: unknown;
}

function playable(raw: AudiusTrack): boolean {
  if (raw.is_delete || raw.is_unlisted) return false;
  if (raw.is_streamable === false || raw.is_available === false) return false;
  return raw.stream_conditions === null || raw.stream_conditions === undefined;
}

function artworkMirrors(artwork: AudiusArtwork | null | undefined): string[] | undefined {
  const primary = artwork?.["480x480"] ?? artwork?.["1000x1000"] ?? artwork?.["150x150"];
  const mirrors = artwork?.mirrors;
  if (!primary || !mirrors?.length) return undefined;

  try {
    const path = new URL(primary).pathname;
    return mirrors.map((host) => `${host.replace(/\/+$/, "")}${path}`);
  } catch {
    return undefined;
  }
}

function toSourceTrack(raw: AudiusTrack): SourceTrack {
  const artist = raw.user?.name?.trim() || raw.user?.handle?.trim();

  return {
    source: "audius",
    sourceId: raw.id,
    title: raw.title,
    artists: artist ? [artist] : [],
    album: null,
    durationMs: raw.duration ? raw.duration * 1000 : null,
    isrc: raw.isrc?.trim() || null,
    url: raw.permalink ? `${WEB}${raw.permalink}` : null,
    artworkUrl: raw.artwork?.["480x480"] ?? raw.artwork?.["1000x1000"] ?? raw.artwork?.["150x150"] ?? null,
    artworkFallbacks: artworkMirrors(raw.artwork),
    playback: "queue",
  };
}

const request = createRequester({
  id: "audius",
  label: "Audius",
  init: cachePolicy,
});

function hostFault(error: unknown): "none" | "fast" | "slow" {
  if (!(error instanceof ProviderError)) return "none";
  if (error.status !== undefined && error.status < 500) return "none";
  const cause = error.cause;
  return cause instanceof DOMException && cause.name === "TimeoutError" ? "slow" : "fast";
}

async function get<T>(hosts: HostPool, ctx: SearchContext, path: string): Promise<T> {
  let failure: unknown;

  for (const host of hosts.order()) {
    try {
      const body = await request<T>(ctx, `${host}/v1${path}`);
      hosts.up(host);
      return body;
    } catch (error) {
      const fault = hostFault(error);
      if (fault === "none") throw error;
      hosts.down(host);
      if (fault === "slow") throw error;
      failure = error;
    }
  }

  throw failure;
}

export function audiusStreamUrl(trackId: string): string {
  return `${AUDIUS_HOSTS[0]}/v1/tracks/${encodeURIComponent(trackId)}/stream?skip_play_count=false`;
}

const VERSIONS = 8;

export function createAudiusProvider(): SearchProvider {
  const hosts = createHostPool(AUDIUS_HOSTS, COOL_DOWN_MS);

  return {
    id: "audius",
    playback: "queue",
    searchable: true,

    async search(ctx, query, limit) {
      const asked = Math.min(limit * 2, 100);
      const data = await get<{ data?: AudiusTrack[] }>(
        hosts,
        ctx,
        `/tracks/search?query=${encodeURIComponent(query)}&limit=${asked}`,
      );
      return (data.data ?? []).filter(playable).slice(0, limit).map(toSourceTrack);
    },

    async radio(ctx, seed: RadioSeed, limit): Promise<RankedList[]> {
      if (!seed.title) return [];

      const query = [seed.title, seed.artist].filter(Boolean).join(" ");
      const asked = Math.min(Math.max(limit, VERSIONS) * 2, 100);

      const data = await get<{ data?: AudiusTrack[] }>(
        hosts,
        ctx,
        `/tracks/search?query=${encodeURIComponent(query)}&limit=${asked}`,
      );
      const tracks = (data.data ?? []).filter(playable).slice(0, VERSIONS).map(toSourceTrack);

      return tracks.length > 0 ? [{ list: "audius:versions", tracks }] : [];
    },
  };
}
