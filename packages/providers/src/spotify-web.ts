import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import { deadlineSignal } from "./request.ts";
import type { SearchContext, SourceTrack } from "./types.ts";

const BOOTSTRAP = "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC";
const PATHFINDER = "https://api-partner.spotify.com/pathfinder/v1/query";
const UPSTREAM_TABLE =
  "https://raw.githubusercontent.com/AliAkhtari78/SpotifyScraper/master/src/spotify_scraper/api/pathfinder.py";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const PAGE_HEADERS = { "User-Agent": USER_AGENT, "Accept-Language": "en" };

export const SPOTIFY_OPERATIONS = {
  search: { name: "searchDesktop", sha256: "db61238974d27839a136c9dc02bfdbe3fab7635f21cf85976ebff9a1ee281345" },
  album: { name: "getAlbum", sha256: "6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361" },
  playlist: { name: "fetchPlaylist", sha256: "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0" },
} as const;

export type OperationKey = keyof typeof SPOTIFY_OPERATIONS;
type Hashes = Partial<Record<OperationKey, string>>;

const KEY_BY_NAME = Object.fromEntries(
  Object.entries(SPOTIFY_OPERATIONS).map(([key, operation]) => [operation.name, key as OperationKey]),
) as Record<string, OperationKey>;

async function get(
  ctx: SearchContext,
  url: string,
  caller?: AbortSignal,
  headers: HeadersInit = PAGE_HEADERS,
  ms?: number,
): Promise<Response> {
  await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
  return fetch(url, { signal: deadlineSignal(caller, ms), cache: "no-store", headers });
}

export function spotifyEmbedState<T>(html: string): T | null {
  const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!payload?.[1]) return null;
  try {
    const data = JSON.parse(payload[1]) as { props?: { pageProps?: { state?: T } } };
    return data.props?.pageProps?.state ?? null;
  } catch {
    return null;
  }
}

export interface AnonymousSession {
  token: string;
  expiresAt: number;
}

const EXPIRY_MARGIN_MS = 2 * 60 * 1000;
const BOOTSTRAP_ATTEMPTS = 3;

export function isFresh(session: AnonymousSession | null, now: number): boolean {
  return session !== null && session.expiresAt - EXPIRY_MARGIN_MS > now;
}

export function sessionFromEmbed(html: string): AnonymousSession | null {
  const session = spotifyEmbedState<{
    settings?: { session?: { accessToken?: unknown; accessTokenExpirationTimestampMs?: unknown } };
  }>(html)?.settings?.session;
  const token = session?.accessToken;
  const expiresAt = session?.accessTokenExpirationTimestampMs;
  return typeof token === "string" && token && typeof expiresAt === "number" ? { token, expiresAt } : null;
}

let current: AnonymousSession | null = null;
let pending: Promise<AnonymousSession> | null = null;

async function bootstrap(ctx: SearchContext): Promise<AnonymousSession> {
  let best: AnonymousSession | null = null;
  for (let attempt = 0; attempt < BOOTSTRAP_ATTEMPTS; attempt += 1) {
    const response = await get(ctx, BOOTSTRAP);
    if (!response.ok) {
      const kind = response.status === 429 ? "rate_limited" : "transient";
      throw new ProviderError("spotify", kind, `Spotify's embed page answered ${response.status}.`, {
        status: response.status,
      });
    }
    const session = sessionFromEmbed(await response.text());
    if (!session) {
      throw new ProviderError("spotify", "unknown", "Spotify's embed page no longer carries a session token.");
    }
    if (!best || session.expiresAt > best.expiresAt) best = session;
    if (isFresh(best, Date.now())) return best;
  }
  return best!;
}

async function anonymousToken(ctx: SearchContext, force: boolean): Promise<string> {
  if (!force && current && isFresh(current, Date.now())) return current.token;
  pending ??= bootstrap(ctx).finally(() => {
    pending = null;
  });
  current = await pending;
  return current.token;
}

const healed: Hashes = {};

function hashFor(operation: OperationKey): string {
  return healed[operation] ?? SPOTIFY_OPERATIONS[operation].sha256;
}

export function pathfinderUrl(operation: OperationKey, variables: Record<string, unknown>): string {
  const params = new URLSearchParams({
    operationName: SPOTIFY_OPERATIONS[operation].name,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hashFor(operation) } }),
  });
  return `${PATHFINDER}?${params}`;
}

async function pathfinder<T>(
  ctx: SearchContext,
  operation: OperationKey,
  variables: Record<string, unknown>,
): Promise<T | null> {
  let refreshed = false;
  let rediscovered = false;

  for (;;) {
    ctx.signal?.throwIfAborted();
    const token = await anonymousToken(ctx, refreshed);
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(pathfinderUrl(operation, variables), {
      signal: deadlineSignal(ctx.signal),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "app-platform": "WebPlayer",
        ...PAGE_HEADERS,
        Accept: "application/json",
      },
    });
    const { status } = response;

    if (status === 401) {
      if (refreshed) {
        throw new ProviderError("spotify", "auth_expired", "Spotify refused a freshly issued anonymous token.", {
          status,
        });
      }
      refreshed = true;
      continue;
    }
    if (status === 404) return null;
    if (status === 429) {
      throw new ProviderError("spotify", "rate_limited", "Spotify is rate-limiting this server.", { status });
    }
    if (!response.ok) {
      const kind = status >= 500 ? "transient" : "unknown";
      throw new ProviderError("spotify", kind, `Spotify answered ${status}.`, { status });
    }

    const body = (await response.json()) as { data?: T; errors?: { message?: string }[] };
    if (!body.errors?.some((error) => error.message === "PersistedQueryNotFound")) return body.data ?? null;

    if (!rediscovered) {
      rediscovered = true;
      const stale = hashFor(operation);
      const found = (await discoverHashesFrom(ctx)).hashes[operation];
      if (found && found !== stale) {
        healed[operation] = found;
        continue;
      }
    }
    throw new ProviderError(
      "spotify",
      "unknown",
      `Spotify retired the ${SPOTIFY_OPERATIONS[operation].name} query and no replacement could be found.`,
    );
  }
}

const DEFINITIONS = {
  bundle: /"(\w+)","query","([0-9a-f]{64})"/g,
  upstream: /Operation\(\s*"(\w+)",\s*"([0-9a-f]{64})"/g,
};

type HashSource = keyof typeof DEFINITIONS;

export function hashesFrom(source: HashSource, text: string): Hashes {
  const found: Hashes = {};
  for (const [, name, hash] of text.matchAll(DEFINITIONS[source])) {
    const key = KEY_BY_NAME[name!];
    if (key) found[key] ??= hash!;
  }
  return found;
}

export function chunkUrl(mainJs: string, mainUrl: string, name: string): string | null {
  const at = mainJs.indexOf(`:"${name}"`);
  if (at === -1) return null;
  const id = /(\d+)$/.exec(mainJs.slice(Math.max(0, at - 12), at))?.[1];
  const end = mainJs.indexOf('+".js"', at);
  if (!id || end === -1) return null;
  const hash = new RegExp(`[{,]${id}:"([0-9a-f]{8,20})"`).exec(mainJs.slice(at, end))?.[1];
  return hash ? new URL(`${name}.${hash}.js`, mainUrl).toString() : null;
}

const DISCOVERY_TTL_MS = 30 * 60 * 1000;

export interface DiscoveredHashes {
  hashes: Hashes;
  from: Partial<Record<OperationKey, HashSource>>;
}

let discovered: { at: number; result: DiscoveredHashes } | null = null;
let discovering: Promise<DiscoveredHashes> | null = null;

export async function discoverHashesFrom(ctx: SearchContext, fresh = false): Promise<DiscoveredHashes> {
  if (!fresh && discovered && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.result;

  discovering ??= (async () => {
    const result: DiscoveredHashes = { hashes: {}, from: {} };
    const text = async (url: string) => {
      const response = await get(ctx, url, undefined, { "User-Agent": USER_AGENT }, 20_000);
      return response.ok ? response.text() : null;
    };
    const adopt = (source: HashSource, script: string | null) => {
      if (!script) return;
      for (const [key, hash] of Object.entries(hashesFrom(source, script)) as [OperationKey, string][]) {
        if (result.hashes[key]) continue;
        result.hashes[key] = hash;
        result.from[key] = source;
      }
    };

    try {
      const page = (await text("https://open.spotify.com/search")) ?? "";
      const mainUrl = /src="([^"]+\/web-player\.[0-9a-f]+\.js)"/.exec(page)?.[1];
      const main = mainUrl ? await text(mainUrl) : null;
      if (mainUrl && main) {
        adopt("bundle", main);
        const chunk = result.hashes.search ? null : chunkUrl(main, mainUrl, "xpui-routes-search");
        if (chunk) adopt("bundle", await text(chunk));
      }
    } catch {}

    if (Object.keys(result.hashes).length < Object.keys(SPOTIFY_OPERATIONS).length) {
      try {
        adopt("upstream", await text(UPSTREAM_TABLE));
      } catch {}
    }

    discovered = { at: Date.now(), result };
    return result;
  })().finally(() => {
    discovering = null;
  });

  return discovering;
}

export function healedSpotifyHashes(): Hashes {
  return { ...healed };
}

interface RawImage {
  url?: string;
  width?: number | null;
}

interface RawArtists {
  items?: { profile?: { name?: string } }[];
}

interface RawTrack {
  __typename?: string;
  id?: string;
  uri?: string;
  name?: string;
  duration?: { totalMilliseconds?: number };
  trackDuration?: { totalMilliseconds?: number };
  artists?: RawArtists;
  playability?: { playable?: boolean };
  albumOfTrack?: { name?: string; coverArt?: { sources?: RawImage[] } };
}

const TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;

function pickCover(sources: RawImage[] | undefined): string | null {
  const usable = (sources ?? []).filter((source) => source.url);
  const best =
    usable.find((source) => source.width === 300) ??
    usable.sort((a, b) => (b.width ?? 10_000) - (a.width ?? 10_000))[0];
  return best?.url ?? null;
}

function artistNames(artists: RawArtists | undefined): string[] {
  return (artists?.items ?? [])
    .map((artist) => artist.profile?.name?.trim())
    .filter((name): name is string => Boolean(name));
}

export function spotifySourceTrack(
  id: string,
  fields: Pick<SourceTrack, "title" | "artists" | "album" | "durationMs" | "artworkUrl" | "previewUrl">,
): SourceTrack {
  return {
    source: "spotify",
    sourceId: id,
    ...fields,
    isrc: null,
    url: `https://open.spotify.com/track/${id}`,
    playback: "manual",
  };
}

function toSourceTrack(raw: RawTrack | undefined, fallback: { album?: string; cover?: string | null } = {}) {
  if (!raw || (raw.__typename && raw.__typename !== "Track")) return null;
  const id = raw.id ?? TRACK_URI.exec(raw.uri ?? "")?.[1];
  const title = raw.name?.trim();
  if (!id || !title || raw.playability?.playable === false) return null;

  return spotifySourceTrack(id, {
    title,
    artists: artistNames(raw.artists),
    album: raw.albumOfTrack?.name ?? fallback.album ?? null,
    durationMs: raw.duration?.totalMilliseconds ?? raw.trackDuration?.totalMilliseconds ?? null,
    artworkUrl: pickCover(raw.albumOfTrack?.coverArt?.sources) ?? fallback.cover ?? null,
  });
}

interface RawSearch {
  searchV2?: { tracksV2?: { items?: { item?: { data?: RawTrack } }[] } };
}

export function tracksFromSearch(data: RawSearch | null): SourceTrack[] {
  return (data?.searchV2?.tracksV2?.items ?? []).flatMap((entry) => toSourceTrack(entry.item?.data) ?? []);
}

export async function searchSpotifyWeb(ctx: SearchContext, query: string, limit = 10): Promise<SourceTrack[]> {
  const searchTerm = query.trim();
  if (!searchTerm) return [];

  const data = await pathfinder<RawSearch>(ctx, "search", {
    searchTerm,
    offset: 0,
    limit: Math.min(Math.max(limit, 1), 50),
    numberOfTopResults: 5,
    includeAudiobooks: false,
    includePreReleases: false,
    includeAlbumPreReleases: false,
    includeAuthors: false,
    includeEpisodeContentRatingsV2: false,
  });
  return tracksFromSearch(data);
}

export type SpotifyCollectionKind = "album" | "playlist";

export interface SpotifyCollection {
  kind: SpotifyCollectionKind;
  id: string;
  title: string;
  by: string | null;
  year: string | null;
  coverUrl: string | null;
  total: number;
  tracks: SourceTrack[];
}

interface RawAlbum {
  albumUnion?: {
    __typename?: string;
    name?: string;
    date?: { isoString?: string };
    artists?: RawArtists;
    coverArt?: { sources?: RawImage[] };
    tracksV2?: { totalCount?: number; items?: { track?: RawTrack }[] };
  };
}

interface RawPlaylist {
  playlistV2?: {
    __typename?: string;
    name?: string;
    ownerV2?: { data?: { name?: string } };
    images?: { items?: { sources?: RawImage[] }[] };
    content?: { totalCount?: number; items?: { itemV2?: { __typename?: string; data?: RawTrack } }[] };
  };
}

export function albumFromResponse(id: string, data: RawAlbum | null): SpotifyCollection | null {
  const album = data?.albumUnion;
  const title = album?.name?.trim();
  if (!album || album.__typename === "NotFound" || !title) return null;

  const cover = pickCover(album.coverArt?.sources);
  return {
    kind: "album",
    id,
    title,
    by: artistNames(album.artists).join(", ") || null,
    year: album.date?.isoString?.slice(0, 4) ?? null,
    coverUrl: cover,
    total: album.tracksV2?.totalCount ?? 0,
    tracks: (album.tracksV2?.items ?? []).flatMap(
      (entry) => toSourceTrack(entry.track, { album: title, cover }) ?? [],
    ),
  };
}

export function playlistFromResponse(id: string, data: RawPlaylist | null): SpotifyCollection | null {
  const playlist = data?.playlistV2;
  const title = playlist?.name?.trim();
  if (!playlist || playlist.__typename === "NotFound" || !title) return null;

  return {
    kind: "playlist",
    id,
    title,
    by: playlist.ownerV2?.data?.name?.trim() || null,
    year: null,
    coverUrl: pickCover(playlist.images?.items?.[0]?.sources),
    total: playlist.content?.totalCount ?? 0,
    tracks: (playlist.content?.items ?? []).flatMap(({ itemV2 }) =>
      itemV2?.__typename === "TrackResponseWrapper" ? (toSourceTrack(itemV2.data) ?? []) : [],
    ),
  };
}

interface EmbedEntity {
  name?: string;
  title?: string;
  subtitle?: string;
  releaseDate?: { isoString?: string };
  coverArt?: { sources?: RawImage[] };
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
  trackList?: {
    uri?: string;
    title?: string;
    subtitle?: string;
    duration?: number;
    isPlayable?: boolean;
    audioPreview?: { url?: string };
  }[];
}

export function collectionFromEmbed(kind: SpotifyCollectionKind, id: string, html: string): SpotifyCollection | null {
  const entity = spotifyEmbedState<{ data?: { entity?: EmbedEntity } }>(html)?.data?.entity;
  const title = (entity?.name ?? entity?.title)?.trim();
  if (!entity || !title) return null;

  const images = [...(entity.visualIdentity?.image ?? [])].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0));
  const cover = pickCover(entity.coverArt?.sources) ?? images.find((image) => image.url)?.url ?? null;
  const list = entity.trackList ?? [];

  return {
    kind,
    id,
    title,
    by: entity.subtitle?.trim() || null,
    year: kind === "album" ? (entity.releaseDate?.isoString?.slice(0, 4) ?? null) : null,
    coverUrl: cover,
    total: list.length,
    tracks: list.flatMap((track) => {
      const trackId = TRACK_URI.exec(track.uri ?? "")?.[1];
      const name = track.title?.trim();
      if (!trackId || !name || track.isPlayable === false) return [];
      return spotifySourceTrack(trackId, {
        title: name,
        artists: (track.subtitle ?? "")
          .split(",")
          .map((artist) => artist.trim())
          .filter(Boolean),
        album: kind === "album" ? title : null,
        durationMs: track.duration ?? null,
        artworkUrl: cover,
        previewUrl: track.audioPreview?.url ?? null,
      });
    }),
  };
}

export async function fetchSpotifyCollectionFromEmbed(
  ctx: SearchContext,
  kind: SpotifyCollectionKind,
  id: string,
): Promise<SpotifyCollection | null> {
  const response = await get(ctx, `https://open.spotify.com/embed/${kind}/${id}`, ctx.signal);
  return response.ok ? collectionFromEmbed(kind, id, await response.text()) : null;
}

export async function fetchSpotifyCollection(
  ctx: SearchContext,
  kind: SpotifyCollectionKind,
  id: string,
  { fallback = true }: { fallback?: boolean } = {},
): Promise<SpotifyCollection | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;

  try {
    if (kind === "album") {
      const variables = { uri: `spotify:album:${id}`, locale: "", offset: 0, limit: 50 };
      return albumFromResponse(id, await pathfinder<RawAlbum>(ctx, "album", variables));
    }
    const variables = { uri: `spotify:playlist:${id}`, offset: 0, limit: 100, enableWatchFeedEntrypoint: false };
    return playlistFromResponse(id, await pathfinder<RawPlaylist>(ctx, "playlist", variables));
  } catch (cause) {
    if (!fallback || (cause instanceof DOMException && cause.name === "AbortError")) throw cause;
    return fetchSpotifyCollectionFromEmbed(ctx, kind, id);
  }
}

export function resetSpotifyWebSession(): void {
  current = null;
  pending = null;
  discovered = null;
  discovering = null;
  for (const key of Object.keys(healed) as OperationKey[]) delete healed[key];
}
