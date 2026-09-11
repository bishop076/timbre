import { spotifyCollectionPath } from "./spotify/collection-link.ts";

export interface PastedCollection {
  service: "Spotify" | "YouTube" | "YouTube Music";
  noun: "album" | "playlist";
  href: string;
  withSong: boolean;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);

function isPlaylistId(id: string): boolean {
  return /^[A-Za-z0-9_-]{12,64}$/.test(id) && (!id.startsWith("RD") || id.startsWith("RDCLAK5uy_"));
}

export function youtubePlaylistPath(raw: string): PastedCollection | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  const shortLink = host === "youtu.be";
  if (!shortLink && !YOUTUBE_HOSTS.has(host)) return null;

  const list = url.searchParams.get("list");
  if (!list || !isPlaylistId(list)) return null;

  const path = url.pathname.replace(/\/+$/, "");
  const withSong = shortLink ? path.length > 1 : path === "/watch" && url.searchParams.has("v");
  if (!withSong && path !== "/playlist") return null;

  return {
    service: host === "music.youtube.com" ? "YouTube Music" : "YouTube",
    noun: list.startsWith("OLAK5uy_") ? "album" : "playlist",
    href: `/collection/ytmusic-playlist/${list}`,
    withSong,
  };
}

export function pastedCollectionOf(raw: string): PastedCollection | null {
  const spotify = spotifyCollectionPath(raw);
  if (spotify) return { service: "Spotify", noun: spotify.kind, href: spotify.href, withSong: false };
  return youtubePlaylistPath(raw);
}
