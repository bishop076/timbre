import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester, deadlineSignal, takeSlot } from "./request.ts";
import { spotifyEmbedState, spotifySourceTrack } from "./spotify-web.ts";

const TRACK_PATH = /^(?:\/intl-[a-z]{2,5})?(?:\/embed)?\/track\/([A-Za-z0-9]{22})\/?$/;
const SPOTIFY_TRACK_URL = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/;
const MUSICBRAINZ_POLICY = { capacity: 1, refillPerSecond: 1000 / 1_100 };

interface SpotifyEntity {
  title?: string;
  artists?: { name?: string }[];
  duration?: number;
  isPlayable?: boolean;
  visualIdentity?: { image?: { url?: string; maxHeight?: number }[] };
}

interface MusicBrainzRecording {
  id?: string;
  relations?: { url?: { resource?: string } }[];
}

async function quietly<T>(
  ctx: SearchContext,
  url: string,
  read: (response: Response) => Promise<T>,
  headers?: HeadersInit,
): Promise<T | null> {
  const musicBrainz = url.startsWith("https://musicbrainz.org/");
  try {
    for (let attempt = 0; ; attempt++) {
      if (musicBrainz) {
        await takeSlot(ctx, "spotify", "MusicBrainz", { key: "musicbrainz", policy: MUSICBRAINZ_POLICY });
      }
      await takeSlot(ctx, "spotify", "Spotify");
      const response = await fetch(url, { signal: deadlineSignal(ctx.signal), cache: "no-store", headers });
      if (response.ok) return await read(response);
      if (!musicBrainz || attempt > 0 || response.status !== 503) return null;
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return null;
  }
}

export function spotifyTrackId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== "open.spotify.com") return null;
    return TRACK_PATH.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

const oEmbed = createRequester({
  id: "spotify",
  label: "Spotify",
  init: () => ({ cache: "no-store" }),
  softStatuses: [400, 404],
});

async function labsTrackId(ctx: SearchContext, path: string): Promise<string | null> {
  const rows = await quietly(
    ctx,
    `https://labs.api.listenbrainz.org${path}`,
    (response) => response.json() as Promise<{ spotify_track_ids?: string[] }[]>,
  );
  return rows?.[0]?.spotify_track_ids?.[0] ?? null;
}

async function isrcLookup(ctx: SearchContext, isrc: string): Promise<{ mbid: string | null; spotifyId: string | null }> {
  const found = await quietly(
    ctx,
    `https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}?inc=url-rels&fmt=json`,
    async (response) => {
      const recordings = ((await response.json()) as { recordings?: MusicBrainzRecording[] }).recordings ?? [];
      const spotifyId = recordings
        .flatMap((recording) => recording.relations ?? [])
        .map((relation) => SPOTIFY_TRACK_URL.exec(relation.url?.resource ?? "")?.[1])
        .find(Boolean);
      return { mbid: recordings[0]?.id ?? null, spotifyId: spotifyId ?? null };
    },
    { "User-Agent": "Timbre/0.1 ( https://github.com/bishop076/timbre )", Accept: "application/json" },
  );
  return found ?? { mbid: null, spotifyId: null };
}

export async function findSpotifyTrackId(
  ctx: SearchContext,
  lookup: { title: string; artist?: string | null; album?: string | null; isrc?: string | null },
): Promise<string | null> {
  const title = lookup.title.trim();
  if (!title) return null;

  const artist = lookup.artist?.trim();
  const album = lookup.album?.trim();
  if (artist && album) {
    const params = new URLSearchParams({ artist_name: artist, release_name: album, track_name: title });
    const id = await labsTrackId(ctx, `/spotify-id-from-metadata/json?${params}`);
    if (id) return id;
  }

  const isrc = lookup.isrc?.trim();
  if (!isrc) return null;

  const { mbid, spotifyId } = await isrcLookup(ctx, isrc);
  if (spotifyId) return spotifyId;
  if (!mbid) return null;
  return labsTrackId(ctx, `/spotify-id-from-mbid/json?recording_mbid=${encodeURIComponent(mbid)}`);
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

      const entity = await quietly(ctx, `https://open.spotify.com/embed/track/${id}`, async (response) => {
        const state = spotifyEmbedState<{ data?: { entity?: SpotifyEntity } }>(await response.text());
        return state?.data?.entity ?? null;
      });
      const fallback = entity?.title
        ? null
        : await oEmbed<{ title?: string; thumbnail_url?: string }>(
            ctx,
            `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`,
          );

      const title = entity?.title?.trim() || fallback?.title?.trim();
      if (!title || entity?.isPlayable === false) return null;

      const covers = [...(entity?.visualIdentity?.image ?? [])].sort(
        (a, b) => (b.maxHeight ?? 0) - (a.maxHeight ?? 0),
      );
      return spotifySourceTrack(id, {
        title,
        artists: (entity?.artists ?? [])
          .map((artist) => artist.name?.trim())
          .filter((name): name is string => Boolean(name)),
        album: null,
        durationMs: entity?.duration ?? null,
        artworkUrl: covers[0]?.url ?? fallback?.thumbnail_url ?? null,
      });
    },
  };
}
