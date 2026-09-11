/**
 * The Timbre page for a pasted Spotify album or playlist link, or null for anything else.
 *
 * Mirrors `spotifyCollectionOf` in `packages/providers/src/spotify-web.ts`, which the search
 * page cannot import — that package is server-side. The same forms are accepted: plain,
 * localised (`/intl-de/…`) and embed links, with or without a `?si=` share token.
 */
const COLLECTION_PATH = /^(?:\/intl-[a-z]{2,5})?(?:\/embed)?\/(album|playlist)\/([A-Za-z0-9]{22})\/?$/;

export function spotifyCollectionPath(raw: string): { kind: "album" | "playlist"; href: string } | null {
  try {
    const url = new URL(raw.trim());
    if (url.hostname.replace(/^www\./, "") !== "open.spotify.com") return null;
    const match = COLLECTION_PATH.exec(url.pathname);
    if (!match) return null;
    const kind = match[1] as "album" | "playlist";
    return { kind, href: `/collection/spotify-${kind}/${match[2]}` };
  } catch {
    return null;
  }
}
