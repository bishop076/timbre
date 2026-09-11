// Relative, with its extension: the stores that import this are unit-tested under plain
// `node --test`, which knows nothing of the `@/` alias.
import { ALLOWED_HOSTS } from "../lib/artwork-proxy.ts";
import type { PlayContext, Song, SourceTrack } from "./types";

/**
 * Songs from a trust boundary, rebuilt field by field so nothing downstream can throw on
 * them or be steered by them.
 *
 * `Array.isArray(songs)` used to be the entire check in every place a song could arrive
 * from storage — and nothing downstream guards a field before reading it: the sidebar
 * reads `song.artworkUrl`, the player reads `song.sources.find(…)`, every row reads
 * `song.artists.join(…)`. One `null` in the array was therefore a TypeError thrown during
 * render, on every route, and the store had already persisted it, so it came back on every
 * later load. See docs/SECURITY.md, S-1 — first in the playlists, then again in the chart
 * cache, which is why the check lives here rather than in either store.
 *
 * **Checking the containers was not enough, and neither is checking the scheme** (S-11,
 * S-15). `artists: [1]` passed and then crashed Explore; `artworkUrl: 1` crashed every view
 * that sizes a cover; and an imported file could label `https://accounts-spotify.example`
 * "Open on Spotify" or plant a tracking pixel as a cover, both perfectly valid https. So
 * every element is typed, and every URL must belong to the service it claims to be from —
 * the one input here that a stranger can write is a playlist file someone was sent.
 *
 * Dropped rather than repaired where a record is not a song (no id, no title, no list of
 * artists or sources); repaired where it is one with a bad field — a song with a dead cover
 * still plays, and a list that quietly loses a picture is better than one that loses a song.
 */
export function usableSongs(value: unknown): Song[] {
  if (!Array.isArray(value)) return [];
  const songs: Song[] = [];
  for (const entry of value) {
    const song = usableSong(entry);
    if (song) songs.push(song);
  }
  return songs;
}

/** One song, rebuilt from only the fields it is allowed to carry, or `null`. */
export function usableSong(value: unknown): Song | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.title !== "string") return null;
  if (!Array.isArray(raw.artists) || !Array.isArray(raw.sources)) return null;

  const fallbacks = Array.isArray(raw.artworkFallbacks)
    ? raw.artworkFallbacks.filter(isArtwork)
    : [];
  const from = usableContext(raw.from);

  return {
    id: raw.id,
    title: raw.title,
    artists: raw.artists.filter((artist): artist is string => typeof artist === "string"),
    album: typeof raw.album === "string" ? raw.album : null,
    durationMs:
      typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs >= 0
        ? raw.durationMs
        : null,
    isrc: typeof raw.isrc === "string" ? raw.isrc : null,
    artworkUrl: isArtwork(raw.artworkUrl) ? raw.artworkUrl : null,
    ...(fallbacks.length > 0 ? { artworkFallbacks: fallbacks } : {}),
    sources: raw.sources.map(usableSource).filter((source): source is SourceTrack => source !== null),
    ...(from ? { from } : {}),
  };
}

const PLAYBACK = new Set<SourceTrack["playback"]>(["queue", "manual", "link"]);

/**
 * The hosts each source's own page lives on. A `url` is where "open on X" sends the reader
 * and, for SoundCloud, what its widget loads — so one that does not belong to the source it
 * names is dropped, not followed. Kept to what the providers actually produce.
 */
const SOURCE_HOSTS: Record<string, readonly string[]> = {
  ytmusic: ["music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"],
  soundcloud: ["soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"],
  audius: ["audius.co"],
  mixcloud: ["www.mixcloud.com", "mixcloud.com", "m.mixcloud.com"],
  archive: ["archive.org"],
  spotify: ["open.spotify.com"],
  deezer: ["www.deezer.com", "deezer.com", "deezer.page.link", "link.deezer.com"],
  apple: ["music.apple.com", "itunes.apple.com", "geo.music.apple.com"],
};

/** Where the catalogues serve their thirty-second clips. Played by Timbre's own `<audio>`,
 * so a planted one would play a stranger's file under a real song's name. */
const PREVIEW_HOSTS = [".dzcdn.net", ".itunes.apple.com", ".mzstatic.com", ".scdn.co"];

function usableSource(value: unknown): SourceTrack | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.source !== "string" || typeof raw.sourceId !== "string") return null;

  const playback = PLAYBACK.has(raw.playback as SourceTrack["playback"])
    ? (raw.playback as SourceTrack["playback"])
    : "link";
  const url = typeof raw.url === "string" && onHosts(raw.url, SOURCE_HOSTS[raw.source] ?? []) ? raw.url : null;
  const previewUrl =
    typeof raw.previewUrl === "string" && underDomains(raw.previewUrl, PREVIEW_HOSTS) ? raw.previewUrl : null;

  return {
    source: raw.source,
    sourceId: raw.sourceId,
    url,
    playback,
    ...(previewUrl ? { previewUrl } : {}),
  };
}

/** The one context there is. Anything else is dropped; the song plays the same without it. */
function usableContext(value: unknown): PlayContext | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "artist" || typeof raw.name !== "string") return null;
  return { kind: "artist", name: raw.name, imageUrl: isArtwork(raw.imageUrl) ? raw.imageUrl : null };
}

/** Audius covers are served by whichever operator-run content node holds the track, so no
 * host list can name them — see `artwork-url.ts`. What can be required is their path. */
const AUDIUS_COVER = /^\/content\/[A-Za-z0-9]+\/(150x150|480x480|1000x1000)\.jpg$/;

/**
 * Whether a cover is one Timbre would have produced: a host `/api/art` proxies, or an Audius
 * content node's path. A cover from anywhere else is a request to a stranger's server the
 * moment a list renders.
 */
export function isArtwork(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const url = parse(value);
  if (!url || url.protocol !== "https:") return false;
  return ALLOWED_HOSTS.has(url.hostname) || AUDIUS_COVER.test(url.pathname);
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function onHosts(value: string, hosts: readonly string[]): boolean {
  const url = parse(value);
  return Boolean(url && url.protocol === "https:" && hosts.includes(url.hostname));
}

function underDomains(value: string, suffixes: readonly string[]): boolean {
  const url = parse(value);
  return Boolean(url && url.protocol === "https:" && suffixes.some((suffix) => url.hostname.endsWith(suffix)));
}
