import { spotifyCollectionPath } from "./spotify/collection-link.ts";

/**
 * A pasted link that names a whole list rather than a song — a Spotify album or playlist, or a
 * YouTube or YouTube Music playlist — as the Timbre page that opens it. The search page shows
 * it as a card to follow instead of a result.
 */
export interface PastedCollection {
  /** Whose link it was, as the card names it. */
  service: "Spotify" | "YouTube" | "YouTube Music";
  noun: "album" | "playlist";
  href: string;
  /**
   * Whether the link names a song too. A `watch?v=…&list=…` link is a song being played from a
   * list, and asking which of the two was meant has no good answer — so the song still resolves
   * below the card, and the list is one tap away above it.
   */
  withSong: boolean;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com"]);

/**
 * Mirrors `isYtMusicPlaylistId` in `packages/providers/src/ytmusic.ts`, which this cannot
 * import — that package is server-side. A radio mix (`RD…`, bar YouTube Music's editorial
 * `RDCLAK5uy_` lists) has no playlist page to open, and it is exactly what the `list=` on a
 * song opened from a mix carries, so offering it would put a card on the screen that 404s.
 */
function isPlaylistId(id: string): boolean {
  return /^[A-Za-z0-9_-]{12,64}$/.test(id) && (!id.startsWith("RD") || id.startsWith("RDCLAK5uy_"));
}

/** The Timbre page for a pasted YouTube or YouTube Music playlist link, or null for anything else. */
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
    // How YouTube Music shares an album: its `OLAK5uy_` list, under /playlist.
    noun: list.startsWith("OLAK5uy_") ? "album" : "playlist",
    href: `/collection/ytmusic-playlist/${list}`,
    withSong,
  };
}

/** Any pasted link that opens a list, or null. */
export function pastedCollectionOf(raw: string): PastedCollection | null {
  const spotify = spotifyCollectionPath(raw);
  if (spotify) return { service: "Spotify", noun: spotify.kind, href: spotify.href, withSong: false };
  return youtubePlaylistPath(raw);
}
