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
// Its `api/pathfinder.py` is the upstream for the operation hashes below: when a lookup starts
// failing with `PersistedQueryNotFound`, the new hash is probably already there.
//
// **Still Spotify's private surface.** The hashes rotate and the payload shapes drift, so every
// failure here abstains or throws a classified error — it never takes a page down. Tracks keep
// `playback: "manual"`: this changes how Spotify is *found*, not how it plays. See `spotify.ts`.

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
 * Every pathfinder operation Timbre uses, and the only place their hashes live — a rotation
 * is a one-line change. Copied from SpotifyScraper v3.9 and verified live 2026-09-11.
 */
export const SPOTIFY_OPERATIONS = {
  search: { name: "searchDesktop", sha256: "eff59fa0a3d026b88b56fddbcf4bdfa16a186b8175a5c1a358c072e053c2e5b0" },
  album: { name: "getAlbum", sha256: "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10" },
  playlist: { name: "fetchPlaylist", sha256: "a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4" },
} as const;

type OperationKey = keyof typeof SPOTIFY_OPERATIONS;

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

/** The persisted-query GET for an operation. Exported for the tests. */
export function pathfinderUrl(operation: OperationKey, variables: Record<string, unknown>): string {
  const { name, sha256 } = SPOTIFY_OPERATIONS[operation];
  const params = new URLSearchParams({
    operationName: name,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: sha256 } }),
  });
  return `${PATHFINDER}?${params}`;
}

/**
 * One pathfinder query's `data`, or null when Spotify says the thing does not exist.
 *
 * A `401` is retried once with a fresh token: a token can be revoked before its stated expiry,
 * and the first request after that is how anyone finds out. Anything else is classified and
 * thrown, so the caller can say *why* rather than show an empty list.
 */
async function pathfinder<T>(
  ctx: SearchContext,
  operation: OperationKey,
  variables: Record<string, unknown>,
): Promise<T | null> {
  const url = pathfinderUrl(operation, variables);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    ctx.signal?.throwIfAborted();
    const token = await anonymousToken(ctx, attempt > 0);
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);

    const response = await fetch(url, {
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

    if (response.status === 401 && attempt === 0) continue;
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
    if (body.errors?.some((error) => error.message === "PersistedQueryNotFound")) {
      // Spotify rotated the hash. Loud on purpose: this is the one failure that needs a code
      // change, and it looks exactly like "no results" if it is swallowed.
      throw new ProviderError(
        "spotify",
        "unknown",
        `Spotify retired the ${SPOTIFY_OPERATIONS[operation].name} query. The hash in spotify-web.ts needs updating.`,
      );
    }
    return body.data ?? null;
  }

  throw new ProviderError("spotify", "auth_expired", "Spotify refused a freshly issued anonymous token.", { status: 401 });
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

/** The first page of an album or playlist — up to 100 tracks, the most a collection page shows. */
export async function fetchSpotifyCollection(
  ctx: SearchContext,
  kind: SpotifyCollectionKind,
  id: string,
): Promise<SpotifyCollection | null> {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;

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

/** Forgets the session. For tests, which need each case to bootstrap from its own stub. */
export function resetSpotifyWebSession(): void {
  current = null;
  pending = null;
}
