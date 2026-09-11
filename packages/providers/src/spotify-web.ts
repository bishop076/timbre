// Spotify's catalogue with no key, no account and no developer app — read the way Spotify's
// own embed player reads it.
//
// **Where the token comes from.** Every public embed page (`open.spotify.com/embed/track/…`)
// carries a short-lived *anonymous* bearer token in its `__NEXT_DATA__` payload, handed out
// so the embed can talk to Spotify's GraphQL gateway ("pathfinder"). Nothing is logged in,
// generated or reverse-engineered: the page is fetched, the token is read. That is the
// difference from the TOTP route most "free Spotify API" projects take — minting web-player
// tokens from a secret lifted out of Spotify's JavaScript, which Spotify rotates and has sent
// cease-and-desist letters over. Measured 2026-09-11: a token lives up to ~55 minutes.
//
// **Whose design this is.** Ported from SpotifyScraper (github.com/AliAkhtari78/SpotifyScraper,
// MIT), whose daily live canary is the best early warning there is for this surface breaking.
//
// **Still Spotify's private surface, so it mends itself where it can.** Three things break it,
// and each has an answer here rather than a code change:
//
// - **A query hash is retired** (`PersistedQueryNotFound`). The current hash is read out of
//   Spotify's own web-player bundle — the file that has to know it — with SpotifyScraper's
//   table as the second source, and the query is retried. See `discoverHashes`.
// - **The token is refused** (`401`). A fresh one is fetched and the query retried once.
// - **Pathfinder is down or reshaped.** Albums and playlists fall back to the embed page's own
//   track list, which needs no token at all. Search has no such page; the reader's own account
//   is its fallback, in `spotify-section.tsx`.
//
// `scripts/spotify-canary.mts` exercises all of it against the real service every day.
// Tracks keep `playback: "manual"`: this changes how Spotify is *found*, not how it plays.

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import { deadlineSignal } from "./request.ts";
import type { SearchContext, SourceTrack } from "./types.ts";

/** Any public track works; this one is SpotifyScraper's default and has been stable for years. */
const BOOTSTRAP = "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC";
const PATHFINDER = "https://api-partner.spotify.com/pathfinder/v1/query";

/** A current desktop browser. The embed page serves a different, token-less shell to bots. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Every pathfinder operation Timbre uses, and the hashes it starts from. Read out of Spotify's
 * own web-player bundle on 2026-09-11 (`web-player.2c51c6eb.js` and its `xpui-routes-search`
 * chunk) — the newest, so the last to be retired. When one is, `discoverHashes` finds its
 * successor at runtime and the canary says so; updating this table then saves every server
 * instance that discovery.
 */
export const SPOTIFY_OPERATIONS = {
  search: { name: "searchDesktop", sha256: "db61238974d27839a136c9dc02bfdbe3fab7635f21cf85976ebff9a1ee281345" },
  album: { name: "getAlbum", sha256: "6a74b456cd1735c9193d9e8ec8cc5184cad7ce13572210315229db3975964361" },
  playlist: { name: "fetchPlaylist", sha256: "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0" },
} as const;

export type OperationKey = keyof typeof SPOTIFY_OPERATIONS;

/** Operation names as Spotify spells them, mapped back to the keys above. */
const KEY_BY_NAME = Object.fromEntries(
  Object.entries(SPOTIFY_OPERATIONS).map(([key, operation]) => [operation.name, key as OperationKey]),
) as Record<string, OperationKey>;

// --- The anonymous session ---------------------------------------------------------------

export interface AnonymousSession {
  token: string;
  /** Unix milliseconds. */
  expiresAt: number;
}

/**
 * Refreshed this long before it lapses, so no request goes out on a token that dies in flight.
 * Also the bar a freshly handed-out token must clear: Spotify serves tokens from a pool, and
 * measured ones arrived with anything from 55 minutes to under 8 left.
 */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

/** Whether a session can still be used at `now`. */
export function isFresh(session: AnonymousSession | null, now: number): boolean {
  return session !== null && session.expiresAt - EXPIRY_MARGIN_MS > now;
}

/** The anonymous session an embed page hands its own player, or null if the page has changed. */
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

/**
 * One session per server instance, shared by every request. Held in memory only — never
 * written anywhere, never sent to a browser. (`wolfXspotify-API` commits its token to a public
 * repository every half hour; that is the thing not to copy.)
 */
let current: AnonymousSession | null = null;
/** The bootstrap in flight, so a burst of searches waits on one page fetch, not twenty. */
let pending: Promise<AnonymousSession> | null = null;

/** How many embed pages to try for a token with time left on it before settling. */
const BOOTSTRAP_ATTEMPTS = 3;

async function bootstrap(ctx: SearchContext): Promise<AnonymousSession> {
  let best: AnonymousSession | null = null;

  for (let attempt = 0; attempt < BOOTSTRAP_ATTEMPTS; attempt += 1) {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(BOOTSTRAP, {
      // The deadline only, not the caller's signal: this fetch is shared by every request
      // waiting on `pending`, and the first of them navigating away must not fail the rest.
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

  // Every attempt came back nearly spent. A token with a minute left still works for a minute.
  return best!;
}

/** A usable anonymous token, bootstrapping when there is none or it is about to lapse. */
async function anonymousToken(ctx: SearchContext, force = false): Promise<string> {
  if (!force && current && isFresh(current, Date.now())) return current.token;

  pending ??= bootstrap(ctx).finally(() => {
    pending = null;
  });
  current = await pending;
  return current.token;
}

// --- Pathfinder --------------------------------------------------------------------------

/**
 * Hashes found at runtime to replace retired ones, by operation. Per server instance, like the
 * token, and never persisted: a rebuilt instance starts from the table, which the canary keeps
 * current, and only pays for discovery if the table has gone stale.
 */
const healed: Partial<Record<OperationKey, string>> = {};

/** The hash to send for an operation: a discovered replacement, else the table's. */
function hashFor(operation: OperationKey): string {
  return healed[operation] ?? SPOTIFY_OPERATIONS[operation].sha256;
}

/** The persisted-query GET for an operation. Exported for the tests. */
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

/**
 * One pathfinder query's `data`, or null when Spotify says the thing does not exist.
 *
 * Two failures are mended and retried, once each: a `401` gets a fresh token (a token can be
 * revoked before its stated expiry, and the first request after is how anyone finds out), and a
 * retired hash gets its successor from `discoverHashes`. Anything else is classified and thrown,
 * so the caller can say *why* rather than show an empty list.
 */
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
        // What the web player sends; without it some operations answer with an empty union.
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

    // Spotify retired the hash. Find its successor once; if that finds nothing new, fail loudly,
    // because swallowed this looks exactly like "no results".
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

// --- Finding a retired hash's successor --------------------------------------------------

/** Where Spotify's web player is served; its script tags name the current bundle. */
const WEB_PLAYER = "https://open.spotify.com/search";

/** SpotifyScraper's table — the second source, maintained by a person with a daily canary. */
const UPSTREAM_TABLE =
  "https://raw.githubusercontent.com/AliAkhtari78/SpotifyScraper/master/src/spotify_scraper/api/pathfinder.py";

/** A lazy chunk of the bundle, by its webpack name: `searchDesktop` is defined in this one. */
const SEARCH_CHUNK = "xpui-routes-search";

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Every `new X("name","query","hash",…)` persisted-query definition in a web-player script,
 * for the operations Timbre uses. Pure.
 */
export function hashesFromBundle(js: string): Partial<Record<OperationKey, string>> {
  const found: Partial<Record<OperationKey, string>> = {};
  for (const match of js.matchAll(/"(\w+)","query","([0-9a-f]{64})"/g)) {
    const key = KEY_BY_NAME[match[1]!];
    if (key && !found[key]) found[key] = match[2]!;
  }
  return found;
}

/**
 * The URL of a named lazy chunk, read out of the main bundle's webpack loader —
 * `u.u=e=>""+({…id:"name"…}[e]||e)+"."+{…id:"hash"…}[e]+".js"`, the chunk served from the
 * same directory as the main bundle. Null when the loader no longer looks like that. Pure.
 */
export function chunkUrl(mainJs: string, mainUrl: string, name: string): string | null {
  const at = mainJs.indexOf(`:"${name}"`);
  if (at === -1) return null;
  const id = /(\d+)$/.exec(mainJs.slice(Math.max(0, at - 12), at))?.[1];
  const end = mainJs.indexOf('+".js"', at);
  if (!id || end === -1) return null;
  const hash = new RegExp(`[{,]${id}:"([0-9a-f]{8,20})"`).exec(mainJs.slice(at, end))?.[1];
  return hash ? new URL(`${name}.${hash}.js`, mainUrl).toString() : null;
}

/** SpotifyScraper's `Operation("name", "hash", …)` definitions, for the operations Timbre uses. Pure. */
export function hashesFromUpstream(python: string): Partial<Record<OperationKey, string>> {
  const found: Partial<Record<OperationKey, string>> = {};
  for (const match of python.matchAll(/Operation\(\s*"(\w+)",\s*"([0-9a-f]{64})"/g)) {
    const key = KEY_BY_NAME[match[1]!];
    if (key && !found[key]) found[key] = match[2]!;
  }
  return found;
}

/** How long a discovery answers for. Long enough that a burst of failures shares one. */
const DISCOVERY_TTL_MS = 30 * 60 * 1000;

export interface DiscoveredHashes {
  hashes: Partial<Record<OperationKey, string>>;
  /** Which source supplied each — for the canary, which reports the bundle one failing. */
  from: Partial<Record<OperationKey, "bundle" | "upstream">>;
}

let discovered: { at: number; result: DiscoveredHashes } | null = null;
let discovering: Promise<DiscoveredHashes> | null = null;

/**
 * The hashes Spotify's web player is using right now, falling back to SpotifyScraper's table
 * for any it could not find. Only reached after a `PersistedQueryNotFound`, never on the happy
 * path: the main bundle is ~4MB. Measured 2026-09-11 — the main bundle carries `getAlbum` and
 * `fetchPlaylist`, and `searchDesktop` lives in the `xpui-routes-search` chunk (75KB), found
 * through the loader's name map rather than by fetching all 150-odd chunks.
 */
export async function discoverHashes(ctx: SearchContext): Promise<Partial<Record<OperationKey, string>>> {
  return (await discoverHashesFrom(ctx)).hashes;
}

/** The same, saying where each hash came from. */
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
      // Generous: this is a 4MB script, fetched once per retirement rather than per request.
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
      // The bundle moved or would not load. The upstream table is the second chance.
    }

    if (Object.keys(result.hashes).length < Object.keys(SPOTIFY_OPERATIONS).length) {
      try {
        const table = await text(UPSTREAM_TABLE);
        if (table) adopt(hashesFromUpstream(table), "upstream");
      } catch {
        // Both sources down: the caller reports the retirement as it stands.
      }
    }

    discovered = { at: Date.now(), result };
    return result;
  })().finally(() => {
    discovering = null;
  });

  return discovering;
}

/** Hashes this instance has had to discover, by operation — empty while the table is current. */
export function healedSpotifyHashes(): Partial<Record<OperationKey, string>> {
  return { ...healed };
}

// --- Payload shapes, as much of them as anything here reads ------------------------------

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
  /** Search and albums say `duration`; playlists say `trackDuration`. */
  duration?: { totalMilliseconds?: number };
  trackDuration?: { totalMilliseconds?: number };
  artists?: RawArtists;
  playability?: { playable?: boolean };
  albumOfTrack?: { id?: string; name?: string; coverArt?: { sources?: RawImage[] } };
}

/** The id at the end of a `spotify:{kind}:{id}` uri. */
function idFromUri(uri: string | undefined, kind: string): string | null {
  const match = uri ? new RegExp(`^spotify:${kind}:([A-Za-z0-9]{22})$`).exec(uri) : null;
  return match?.[1] ?? null;
}

/**
 * The cover a row needs: the 300px one when offered, which is what Spotify's own lists use.
 * Unsized sources (playlist mosaics say `null`) count as large.
 */
function pickCover(sources: RawImage[] | undefined): string | null {
  const usable = (sources ?? []).filter((source): source is RawImage & { url: string } => Boolean(source.url));
  if (usable.length === 0) return null;
  const sized = usable.find((source) => source.width === 300);
  return (sized ?? [...usable].sort((a, b) => (b.width ?? 10_000) - (a.width ?? 10_000))[0])!.url;
}

/**
 * One track as a source row. Unplayable ones — withdrawn, or not licensed where this server
 * sits — are dropped: their embed would show an error instead of a play button.
 */
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
    // Pathfinder does not publish ISRCs anonymously. The merger matches on title and artist.
    isrc: null,
    url: `https://open.spotify.com/track/${id}`,
    artworkUrl: pickCover(raw.albumOfTrack?.coverArt?.sources) ?? fallback?.cover ?? null,
    playback: "manual",
  };
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

// --- Search ------------------------------------------------------------------------------

interface RawSearch {
  searchV2?: { tracksV2?: { items?: { item?: { data?: RawTrack } }[] } };
}

/** The tracks in a `searchDesktop` answer, in Spotify's order. Pure. */
export function tracksFromSearch(data: RawSearch | null): SourceTrack[] {
  return compact((data?.searchV2?.tracksV2?.items ?? []).map((entry) => toSourceTrack(entry.item?.data)));
}

/**
 * Spotify's own search, for anyone — the thing a developer app now needs Premium for and
 * caps at five users (and, since Feb 2026, at ten results). Pathfinder takes up to 50.
 */
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

// --- Albums and playlists ----------------------------------------------------------------

export type SpotifyCollectionKind = "album" | "playlist";

export interface SpotifyCollection {
  kind: SpotifyCollectionKind;
  id: string;
  title: string;
  /** The artist for an album, the owner for a playlist. */
  by: string | null;
  /** An album's release year. */
  year: string | null;
  coverUrl: string | null;
  /** How many tracks Spotify says it has — may exceed `tracks`, which is one page. */
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

/** An album answer as a collection. Its tracks carry no sleeve of their own; the album's is theirs. Pure. */
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

/** A playlist answer as a collection. Podcast episodes in it are skipped — Timbre plays songs. Pure. */
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
  /** The artists, comma-joined — the embed carries no list. */
  subtitle?: string;
  /** Milliseconds. */
  duration?: number;
  isPlayable?: boolean;
  audioPreview?: { url?: string };
}

interface EmbedEntity {
  name?: string;
  title?: string;
  /** The artist for an album, the owner for a playlist. */
  subtitle?: string;
  releaseDate?: { isoString?: string };
  trackList?: EmbedTrack[];
  coverArt?: { sources?: RawImage[] };
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
}

/**
 * An album or playlist from its embed page, which carries the whole track list in its
 * `__NEXT_DATA__` and needs no token at all — the fallback for when pathfinder is refusing,
 * reshaped, or retired past rescue. Poorer than the pathfinder answer (one sleeve for every
 * track, artists as one string), but it also carries each track's preview clip. Pure.
 */
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

/** The embed page itself. Its own fetch rather than the bootstrap's, whose page is a track. */
export async function fetchSpotifyCollectionFromEmbed(ctx: SearchContext, kind: SpotifyCollectionKind, id: string): Promise<SpotifyCollection | null> {
  await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
  const response = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
    signal: deadlineSignal(ctx.signal),
    cache: "no-store",
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
  return response.ok ? collectionFromEmbed(kind, id, await response.text()) : null;
}

/**
 * The first page of an album or playlist — up to 100 tracks, the most a collection page
 * shows. Pathfinder first, for its per-track sleeves and artist lists; the embed page when
 * pathfinder throws. Not when it answers "no such thing": the embed would only say the same.
 * `fallback: false` is for the canary, which has to see pathfinder fail rather than be rescued.
 */
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

/** `/album/{22}` or `/playlist/{22}`, in any of the forms `spotifyTrackId` accepts for tracks. */
const COLLECTION_PATH = /^(?:\/intl-[a-z]{2,5})?(?:\/embed)?\/(album|playlist)\/([A-Za-z0-9]{22})\/?$/;

/** The album or playlist a Spotify URL points at, or null for anything else. */
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

/** Forgets the session and anything discovered. For tests, which need each case to bootstrap from its own stub. */
export function resetSpotifyWebSession(): void {
  current = null;
  pending = null;
  discovered = null;
  discovering = null;
  for (const key of Object.keys(healed) as OperationKey[]) delete healed[key];
}
