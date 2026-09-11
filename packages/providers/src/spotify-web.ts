import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import { deadlineSignal } from "./request.ts";
import type { SearchContext, SourceTrack } from "./types.ts";

const BOOTSTRAP = "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC";
const PATHFINDER = "https://api-partner.spotify.com/pathfinder/v1/query";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const SPOTIFY_OPERATIONS = {
  search: { name: "searchDesktop", sha256: "db61238974d27839a136c9dc02bfdbe3fab7635f21cf85976ebff9a1ee281345" },
  album: { name: "getAlbum", sha256: "6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361" },
  playlist: { name: "fetchPlaylist", sha256: "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0" },
} as const;

export type OperationKey = keyof typeof SPOTIFY_OPERATIONS;

const KEY_BY_NAME = Object.fromEntries(
  Object.entries(SPOTIFY_OPERATIONS).map(([key, operation]) => [operation.name, key as OperationKey]),
) as Record<string, OperationKey>;

export interface AnonymousSession {
  token: string;
  expiresAt: number;
}

const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export function isFresh(session: AnonymousSession | null, now: number): boolean {
  return session !== null && session.expiresAt - EXPIRY_MARGIN_MS > now;
}

export function sessionFromEmbed(html: string): AnonymousSession | null {
  const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!payload?.[1]) return null;
  try {
    const data = JSON.parse(payload[1]) as {
      props?: {
        pageProps?: {
          state?: {
            settings?: { session?: { accessToken?: unknown; accessTokenExpirationTimestampMs?: unknown } };
          };
        };
      };
    };
    const session = data.props?.pageProps?.state?.settings?.session;
    const token = session?.accessToken;
    const expiresAt = session?.accessTokenExpirationTimestampMs;
    if (typeof token !== "string" || !token || typeof expiresAt !== "number") return null;
    return { token, expiresAt };
  } catch {
    return null;
  }
}

let current: AnonymousSession | null = null;
let pending: Promise<AnonymousSession> | null = null;

const BOOTSTRAP_ATTEMPTS = 3;

async function bootstrap(ctx: SearchContext): Promise<AnonymousSession> {
  let best: AnonymousSession | null = null;

  for (let attempt = 0; attempt < BOOTSTRAP_ATTEMPTS; attempt += 1) {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(BOOTSTRAP, {
      signal: deadlineSignal(undefined),
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    });
    if (!response.ok) {
      throw new ProviderError("spotify", response.status === 429 ? "rate_limited" : "transient", `Spotify's embed page answered ${response.status}.`, {
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

async function anonymousToken(ctx: SearchContext, force = false): Promise<string> {
  if (!force && current && isFresh(current, Date.now())) return current.token;

  pending ??= bootstrap(ctx).finally(() => {
    pending = null;
  });
  current = await pending;
  return current.token;
}

const healed: Partial<Record<OperationKey, string>> = {};

function hashFor(operation: OperationKey): string {
  return healed[operation] ?? SPOTIFY_OPERATIONS[operation].sha256;
}

export function pathfinderUrl(
  operation: OperationKey,
  variables: Record<string, unknown>,
  sha256: string = hashFor(operation),
): string {
  const params = new URLSearchParams({
    operationName: SPOTIFY_OPERATIONS[operation].name,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: sha256 } }),
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
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });

    if (response.status === 401) {
      if (refreshed) {
        throw new ProviderError("spotify", "auth_expired", "Spotify refused a freshly issued anonymous token.", { status: 401 });
      }
      refreshed = true;
      continue;
    }
    if (response.status === 404) return null;
    if (response.status === 429) {
      throw new ProviderError("spotify", "rate_limited", "Spotify is rate-limiting this server.", { status: 429 });
    }
    if (!response.ok) {
      throw new ProviderError("spotify", response.status >= 500 ? "transient" : "unknown", `Spotify answered ${response.status}.`, {
        status: response.status,
      });
    }

    const body = (await response.json()) as { data?: T; errors?: { message?: string }[] };
    if (!body.errors?.some((error) => error.message === "PersistedQueryNotFound")) return body.data ?? null;

    if (!rediscovered) {
      rediscovered = true;
      const stale = hashFor(operation);
      const found = (await discoverHashes(ctx))[operation];
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

const WEB_PLAYER = "https://open.spotify.com/search";

const UPSTREAM_TABLE =
  "https://raw.githubusercontent.com/AliAkhtari78/SpotifyScraper/master/src/spotify_scraper/api/pathfinder.py";

const SEARCH_CHUNK = "xpui-routes-search";

const SHA256 = /^[0-9a-f]{64}$/;

export function hashesFromBundle(js: string): Partial<Record<OperationKey, string>> {
  const found: Partial<Record<OperationKey, string>> = {};
  for (const match of js.matchAll(/"(\w+)","query","([0-9a-f]{64})"/g)) {
    const key = KEY_BY_NAME[match[1]!];
    if (key && !found[key]) found[key] = match[2]!;
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

export function hashesFromUpstream(python: string): Partial<Record<OperationKey, string>> {
  const found: Partial<Record<OperationKey, string>> = {};
  for (const match of python.matchAll(/Operation\(\s*"(\w+)",\s*"([0-9a-f]{64})"/g)) {
    const key = KEY_BY_NAME[match[1]!];
    if (key && !found[key]) found[key] = match[2]!;
  }
  return found;
}

const DISCOVERY_TTL_MS = 30 * 60 * 1000;

export interface DiscoveredHashes {
  hashes: Partial<Record<OperationKey, string>>;
  from: Partial<Record<OperationKey, "bundle" | "upstream">>;
}

let discovered: { at: number; result: DiscoveredHashes } | null = null;
let discovering: Promise<DiscoveredHashes> | null = null;

export async function discoverHashes(ctx: SearchContext): Promise<Partial<Record<OperationKey, string>>> {
  return (await discoverHashesFrom(ctx)).hashes;
}

export async function discoverHashesFrom(ctx: SearchContext, fresh = false): Promise<DiscoveredHashes> {
  if (!fresh && discovered && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.result;

  discovering ??= (async () => {
    const result: DiscoveredHashes = { hashes: {}, from: {} };
    const adopt = (found: Partial<Record<OperationKey, string>>, source: "bundle" | "upstream") => {
      for (const [key, hash] of Object.entries(found) as [OperationKey, string][]) {
        if (result.hashes[key] || !SHA256.test(hash)) continue;
        result.hashes[key] = hash;
        result.from[key] = source;
      }
    };
    const text = async (url: string) => {
      await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
      const response = await fetch(url, {
        signal: deadlineSignal(undefined, 20_000),
        cache: "no-store",
        headers: { "User-Agent": USER_AGENT },
      });
      return response.ok ? response.text() : null;
    };

    try {
      const page = await text(WEB_PLAYER);
      const mainUrl = page ? /src="([^"]+\/web-player\.[0-9a-f]+\.js)"/.exec(page)?.[1] : undefined;
      const main = mainUrl ? await text(mainUrl) : null;
      if (main && mainUrl) {
        adopt(hashesFromBundle(main), "bundle");
        const chunk = result.hashes.search ? null : chunkUrl(main, mainUrl, SEARCH_CHUNK);
        const search = chunk ? await text(chunk) : null;
        if (search) adopt(hashesFromBundle(search), "bundle");
      }
    } catch {
    }

    if (Object.keys(result.hashes).length < Object.keys(SPOTIFY_OPERATIONS).length) {
      try {
        const table = await text(UPSTREAM_TABLE);
        if (table) adopt(hashesFromUpstream(table), "upstream");
      } catch {
      }
    }

    discovered = { at: Date.now(), result };
    return result;
  })().finally(() => {
    discovering = null;
  });

  return discovering;
}

export function healedSpotifyHashes(): Partial<Record<OperationKey, string>> {
  return { ...healed };
}

interface RawImage {
  url?: string;
  width?: number | null;
  height?: number | null;
}

interface RawArtists {
  items?: { profile?: { name?: string }; uri?: string }[];
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
  albumOfTrack?: { id?: string; name?: string; coverArt?: { sources?: RawImage[] } };
}

function idFromUri(uri: string | undefined, kind: string): string | null {
  const match = uri ? new RegExp(`^spotify:${kind}:([A-Za-z0-9]{22})$`).exec(uri) : null;
  return match?.[1] ?? null;
}

function pickCover(sources: RawImage[] | undefined): string | null {
  const usable = (sources ?? []).filter((source): source is RawImage & { url: string } => Boolean(source.url));
  if (usable.length === 0) return null;
  const sized = usable.find((source) => source.width === 300);
  return (sized ?? [...usable].sort((a, b) => (b.width ?? 10_000) - (a.width ?? 10_000))[0])!.url;
}

function toSourceTrack(raw: RawTrack | undefined, fallback?: { album?: string | null; cover?: string | null }): SourceTrack | null {
  if (!raw || (raw.__typename && raw.__typename !== "Track")) return null;
  const id = raw.id ?? idFromUri(raw.uri, "track");
  const title = raw.name?.trim();
  if (!id || !title || raw.playability?.playable === false) return null;

  return {
    source: "spotify",
    sourceId: id,
    title,
    artists: (raw.artists?.items ?? [])
      .map((artist) => artist.profile?.name?.trim())
      .filter((name): name is string => Boolean(name)),
    album: raw.albumOfTrack?.name ?? fallback?.album ?? null,
    durationMs: raw.duration?.totalMilliseconds ?? raw.trackDuration?.totalMilliseconds ?? null,
    isrc: null,
    url: `https://open.spotify.com/track/${id}`,
    artworkUrl: pickCover(raw.albumOfTrack?.coverArt?.sources) ?? fallback?.cover ?? null,
    playback: "manual",
  };
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

interface RawSearch {
  searchV2?: { tracksV2?: { items?: { item?: { data?: RawTrack } }[] } };
}

export function tracksFromSearch(data: RawSearch | null): SourceTrack[] {
  return compact((data?.searchV2?.tracksV2?.items ?? []).map((entry) => toSourceTrack(entry.item?.data)));
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
  const by = (album.artists?.items ?? [])
    .map((artist) => artist.profile?.name?.trim())
    .filter(Boolean)
    .join(", ");

  return {
    kind: "album",
    id,
    title,
    by: by || null,
    year: album.date?.isoString?.slice(0, 4) ?? null,
    coverUrl: cover,
    total: album.tracksV2?.totalCount ?? 0,
    tracks: compact((album.tracksV2?.items ?? []).map((entry) => toSourceTrack(entry.track, { album: title, cover }))),
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
    tracks: compact(
      (playlist.content?.items ?? []).map((entry) =>
        entry.itemV2?.__typename === "TrackResponseWrapper" ? toSourceTrack(entry.itemV2.data) : null,
      ),
    ),
  };
}

interface EmbedTrack {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  isPlayable?: boolean;
  audioPreview?: { url?: string };
}

interface EmbedEntity {
  name?: string;
  title?: string;
  subtitle?: string;
  releaseDate?: { isoString?: string };
  trackList?: EmbedTrack[];
  coverArt?: { sources?: RawImage[] };
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
}

export function collectionFromEmbed(kind: SpotifyCollectionKind, id: string, html: string): SpotifyCollection | null {
  const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!payload?.[1]) return null;

  let entity: EmbedEntity | undefined;
  try {
    const data = JSON.parse(payload[1]) as { props?: { pageProps?: { state?: { data?: { entity?: EmbedEntity } } } } };
    entity = data.props?.pageProps?.state?.data?.entity;
  } catch {
    return null;
  }

  const title = (entity?.name ?? entity?.title)?.trim();
  if (!entity || !title) return null;

  const images = entity.visualIdentity?.image ?? [];
  const cover =
    pickCover(entity.coverArt?.sources) ??
    [...images].sort((a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0)).find((image) => image.url)?.url ??
    null;
  const list = entity.trackList ?? [];

  const tracks = compact(
    list.map((track): SourceTrack | null => {
      const trackId = idFromUri(track.uri, "track");
      const name = track.title?.trim();
      if (!trackId || !name || track.isPlayable === false) return null;
      return {
        source: "spotify",
        sourceId: trackId,
        title: name,
        artists: (track.subtitle ?? "")
          .split(",")
          .map((artist) => artist.trim())
          .filter(Boolean),
        album: kind === "album" ? title : null,
        durationMs: track.duration ?? null,
        isrc: null,
        url: `https://open.spotify.com/track/${trackId}`,
        artworkUrl: cover,
        playback: "manual",
        previewUrl: track.audioPreview?.url ?? null,
      };
    }),
  );

  return {
    kind,
    id,
    title,
    by: entity.subtitle?.trim() || null,
    year: kind === "album" ? (entity.releaseDate?.isoString?.slice(0, 4) ?? null) : null,
    coverUrl: cover,
    total: list.length,
    tracks,
  };
}

export async function fetchSpotifyCollectionFromEmbed(ctx: SearchContext, kind: SpotifyCollectionKind, id: string): Promise<SpotifyCollection | null> {
  await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
  const response = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
    signal: deadlineSignal(ctx.signal),
    cache: "no-store",
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
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
      const data = await pathfinder<RawAlbum>(ctx, "album", { uri: `spotify:album:${id}`, locale: "", offset: 0, limit: 50 });
      return albumFromResponse(id, data);
    }

    const data = await pathfinder<RawPlaylist>(ctx, "playlist", {
      uri: `spotify:playlist:${id}`,
      offset: 0,
      limit: 100,
      enableWatchFeedEntrypoint: false,
    });
    return playlistFromResponse(id, data);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    if (!fallback) throw cause;
    return fetchSpotifyCollectionFromEmbed(ctx, kind, id);
  }
}

const COLLECTION_PATH = /^(?:\/intl-[a-z]{2,5})?(?:\/embed)?\/(album|playlist)\/([A-Za-z0-9]{22})\/?$/;

export function spotifyCollectionOf(raw: string): { kind: SpotifyCollectionKind; id: string } | null {
  try {
    const url = new URL(raw.trim());
    if (url.hostname.replace(/^www\./, "") !== "open.spotify.com") return null;
    const match = COLLECTION_PATH.exec(url.pathname);
    return match ? { kind: match[1] as SpotifyCollectionKind, id: match[2]! } : null;
  } catch {
    return null;
  }
}

export function resetSpotifyWebSession(): void {
  current = null;
  pending = null;
  discovered = null;
  discovering = null;
  for (const key of Object.keys(healed) as OperationKey[]) delete healed[key];
}
