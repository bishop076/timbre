import { ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
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
const VERSIONS = 8;

interface AudiusTrack {
  id: string;
  title: string;
  duration?: number;
  permalink?: string;
  artwork?: {
    "150x150"?: string;
    "480x480"?: string;
    "1000x1000"?: string;
    mirrors?: string[];
  } | null;
  user?: { name?: string; handle?: string };
  isrc?: string | null;
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

// Audius stores covers on community-run content nodes, so a response names whatever hosts
// hold that track — `audius-creator-7.theblueprint.xyz`, `cn1.mainnet.audiusindex.org`,
// `v.monophonic.digital` — and `artwork.mirrors` is a list of more of them. Handing those
// to the browser would tell a stranger's server who is listening, and would walk past
// `/api/art` entirely, since `proxied()` returns an unlisted host unchanged. Audius serves
// the same bytes from its own API host, so keep the path and drop the host. `usableArtwork`
// in the web app does this for a stored song; doing it here means a live search result is
// already safe before it leaves the server, and the mirrors become the same URL as the
// primary — which is why they are no longer carried.
const COVER_PATH = /^\/content\/[A-Za-z0-9]+\/(?:150x150|480x480|1000x1000)\.jpg$/;

export function audiusCover(raw: string | undefined): string | null {
  const url = raw ? URL.parse(raw) : null;
  return url && COVER_PATH.test(url.pathname) ? `${AUDIUS_HOSTS[0]}${url.pathname}` : null;
}

function permalinkUrl(permalink: string | undefined): string | null {
  const url = permalink ? URL.parse(permalink, "https://audius.co") : null;
  return url?.origin === "https://audius.co" ? url.href : null;
}

function toSourceTrack(raw: AudiusTrack): SourceTrack {
  const artist = raw.user?.name?.trim() || raw.user?.handle?.trim();
  const artwork = raw.artwork?.["480x480"] ?? raw.artwork?.["1000x1000"] ?? raw.artwork?.["150x150"];
  return {
    source: "audius",
    sourceId: raw.id,
    title: raw.title,
    artists: artist ? [artist] : [],
    album: null,
    durationMs: raw.duration ? raw.duration * 1000 : null,
    isrc: raw.isrc?.trim() || null,
    url: permalinkUrl(raw.permalink),
    artworkUrl: audiusCover(artwork),
    playback: "queue",
  };
}

const request = createRequester({ id: "audius", label: "Audius", init: cachePolicy });

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

async function searchTracks(
  hosts: HostPool,
  ctx: SearchContext,
  query: string,
  asked: number,
  keep: number,
) {
  const data = await get<{ data?: AudiusTrack[] }>(
    hosts,
    ctx,
    `/tracks/search?query=${encodeURIComponent(query)}&limit=${asked}`,
  );
  return (data.data ?? []).filter(playable).slice(0, keep).map(toSourceTrack);
}

export function createAudiusProvider(): SearchProvider {
  const hosts = createHostPool(AUDIUS_HOSTS, COOL_DOWN_MS);

  return {
    id: "audius",
    playback: "queue",
    searchable: true,

    search(ctx, query, limit) {
      return searchTracks(hosts, ctx, query, Math.min(limit * 2, 100), limit);
    },

    async radio(ctx, seed, limit) {
      if (!seed.title) return [];
      const query = [seed.title, seed.artist].filter(Boolean).join(" ");
      const asked = Math.min(Math.max(limit, VERSIONS) * 2, 100);
      const tracks = await searchTracks(hosts, ctx, query, asked, VERSIONS);
      return tracks.length > 0 ? [{ list: "audius:versions", tracks }] : [];
    },
  };
}
