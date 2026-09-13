import { allowed } from "../lib/artwork-proxy.ts";
import type { PlayContext, Song, SourceTrack } from "./types";

export function usableSongs(value: unknown): Song[] {
  if (!Array.isArray(value)) return [];
  const songs: Song[] = [];
  for (const entry of value) {
    const song = usableSong(entry);
    if (song) songs.push(song);
  }
  return songs;
}

export function usableSong(value: unknown): Song | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.title !== "string") return null;
  if (!Array.isArray(raw.artists) || !Array.isArray(raw.sources)) return null;

  const artworkUrl = usableArtwork(raw.artworkUrl);
  const fallbacks = Array.isArray(raw.artworkFallbacks)
    ? [...new Set(raw.artworkFallbacks.map(usableArtwork))].filter(
        (url): url is string => url !== null && url !== artworkUrl,
      )
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
    artworkUrl,
    ...(fallbacks.length > 0 ? { artworkFallbacks: fallbacks } : {}),
    sources: raw.sources.map(usableSource).filter((source): source is SourceTrack => source !== null),
    ...(from ? { from } : {}),
  };
}

const PLAYBACK = new Set<SourceTrack["playback"]>(["queue", "manual", "link"]);

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

function usableContext(value: unknown): PlayContext | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "artist" || typeof raw.name !== "string") return null;
  return { kind: "artist", name: raw.name, imageUrl: usableArtwork(raw.imageUrl) };
}

const AUDIUS_COVER = /^\/content\/[A-Za-z0-9]+\/(150x150|480x480|1000x1000)\.jpg$/;
const AUDIUS_API = "https://api.audius.co";

export function usableArtwork(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = parse(value);
  if (!url || url.protocol !== "https:") return null;
  if (allowed(url)) return value;
  return AUDIUS_COVER.test(url.pathname) ? `${AUDIUS_API}${url.pathname}` : null;
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
