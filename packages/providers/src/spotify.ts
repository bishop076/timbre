import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester, deadlineSignal } from "./request.ts";

const OEMBED = "https://open.spotify.com/oembed";
const EMBED = "https://open.spotify.com/embed";

const LABS = "https://labs.api.listenbrainz.org";
const MUSICBRAINZ = "https://musicbrainz.org/ws/2";

const AGENT = "Timbre/0.1 ( https://github.com/bishop076/timbre )";

const TRACK_PATH = /^(?:\/intl-[a-z]{2,5})?(?:\/embed)?\/track\/([A-Za-z0-9]{22})\/?$/;

interface SpotifyOEmbed {
  title?: string;
  thumbnail_url?: string;
}

interface SpotifyEntity {
  title?: string;
  artists?: { name?: string }[];
  duration?: number;
  isPlayable?: boolean;
  visualIdentity?: { image?: { url?: string; maxHeight?: number }[] };
}

async function entityFromEmbed(ctx: SearchContext, trackId: string): Promise<SpotifyEntity | null> {
  try {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(spotifyEmbedUrl(trackId), { signal: deadlineSignal(ctx.signal), cache: "no-store" });
    if (!response.ok) return null;

    const html = await response.text();
    const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!payload?.[1]) return null;

    const data = JSON.parse(payload[1]) as {
      props?: { pageProps?: { state?: { data?: { entity?: SpotifyEntity } } } };
    };
    return data.props?.pageProps?.state?.data?.entity ?? null;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return null;
  }
}

function largestCover(entity: SpotifyEntity | null): string | null {
  const images = entity?.visualIdentity?.image ?? [];
  const best = [...images].sort((a, b) => (b.maxHeight ?? 0) - (a.maxHeight ?? 0))[0];
  return best?.url ?? null;
}

export function spotifyTrackId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "open.spotify.com") return null;
    return TRACK_PATH.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function spotifyEmbedUrl(trackId: string): string {
  return `${EMBED}/track/${encodeURIComponent(trackId)}`;
}

const request = createRequester({
  id: "spotify",
  label: "Spotify",
  init: () => ({ cache: "no-store" }),
  softStatuses: [400, 404],
});

interface LabsRow {
  spotify_track_ids?: string[];
}

export async function findSpotifyTrackId(
  ctx: SearchContext,
  lookup: { title: string; artist?: string | null; album?: string | null; isrc?: string | null },
): Promise<string | null> {
  const title = lookup.title?.trim();
  if (!title) return null;

  const artist = lookup.artist?.trim();
  const album = lookup.album?.trim();

  if (artist && album) {
    const params = new URLSearchParams({
      artist_name: artist,
      release_name: album,
      track_name: title,
    });
    const rows = await labs<LabsRow[]>(ctx, `/spotify-id-from-metadata/json?${params}`);
    const id = rows?.[0]?.spotify_track_ids?.[0];
    if (id) return id;
  }

  const isrc = lookup.isrc?.trim();
  if (!isrc) return null;

  const { mbid, spotifyId } = await isrcLookup(ctx, isrc);
  if (spotifyId) return spotifyId;
  if (!mbid) return null;

  const rows = await labs<LabsRow[]>(
    ctx,
    `/spotify-id-from-mbid/json?recording_mbid=${encodeURIComponent(mbid)}`,
  );
  return rows?.[0]?.spotify_track_ids?.[0] ?? null;
}

async function labs<T>(ctx: SearchContext, path: string): Promise<T | null> {
  try {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(`${LABS}${path}`, { signal: deadlineSignal(ctx.signal), cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return null;
  }
}

interface MusicBrainzRecording {
  id?: string;
  relations?: { url?: { resource?: string } }[];
}

const SPOTIFY_TRACK_URL = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/;

async function isrcLookup(
  ctx: SearchContext,
  isrc: string,
): Promise<{ mbid: string | null; spotifyId: string | null }> {
  const empty = { mbid: null, spotifyId: null };
  try {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(
      `${MUSICBRAINZ}/isrc/${encodeURIComponent(isrc)}?inc=url-rels&fmt=json`,
      {
        signal: deadlineSignal(ctx.signal),
        cache: "no-store",
        headers: { "User-Agent": AGENT, Accept: "application/json" },
      },
    );
    if (!response.ok) return empty;

    const body = (await response.json()) as { recordings?: MusicBrainzRecording[] };
    const recordings = body.recordings ?? [];

    for (const recording of recordings) {
      for (const relation of recording.relations ?? []) {
        const found = SPOTIFY_TRACK_URL.exec(relation.url?.resource ?? "")?.[1];
        if (found) return { mbid: recordings[0]?.id ?? null, spotifyId: found };
      }
    }
    return { mbid: recordings[0]?.id ?? null, spotifyId: null };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return empty;
  }
}

export function createSpotifyProvider(): SearchProvider {
  return {
    id: "spotify",
    playback: "manual",
    searchable: false,

    async search() {
      return [];
    },

    async resolve(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
      const id = spotifyTrackId(url);
      if (!id) return null;

      const entity = await entityFromEmbed(ctx, id);

      const fallback = entity?.title
        ? null
        : await request<SpotifyOEmbed>(
            ctx,
            `${OEMBED}?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`,
          );

      const title = entity?.title?.trim() || fallback?.title?.trim();
      if (!title) return null;

      if (entity && entity.isPlayable === false) return null;

      return {
        source: "spotify",
        sourceId: id,
        title,
        artists: (entity?.artists ?? [])
          .map((artist) => artist.name?.trim())
          .filter((name): name is string => Boolean(name)),
        album: null,
        durationMs: entity?.duration ?? null,
        isrc: null,
        url: `https://open.spotify.com/track/${id}`,
        artworkUrl: largestCover(entity) ?? fallback?.thumbnail_url ?? null,
        playback: "manual",
      };
    },
  };
}
