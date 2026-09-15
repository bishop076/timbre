import type { SourceId } from "./types.ts";

/**
 * The thirty-second clip a provider named, kept only if it is on that provider's own CDN.
 *
 * Three providers carry a `previewUrl`, and all three took the string out of the response and
 * handed it on. It ends up as `<audio src>` in the progressive player, so whatever host is in it
 * is a host the listener's browser connects to — address, user agent and the fact that they are
 * playing this song — and it is the one thing on a track that walks past `/api/art`, which every
 * cover goes through.
 *
 * `song-shape.ts` already refuses exactly this, and has a test that drops
 * `https://evil.example/x.mp3` — but `usableSong` runs on a song read back out of *storage*. A
 * live `/api/search`, `/api/radio` or `/api/resolve` result is neither imported nor stored and is
 * consumed as it arrives, so nothing checked the clip on the path that plays it first. This is
 * the same fix made for Audius covers, at the same place: in the provider, so the URL is
 * already safe before it leaves the server.
 *
 * Measured against the live services on 2026-09-15: Deezer previews come from
 * `cdnt-preview.dzcdn.net`, Apple's from `audio-ssl.itunes.apple.com`, Spotify's from
 * `p.scdn.co` — the same four suffixes `song-shape.ts` settled on, split per provider because
 * nothing legitimate crosses between them.
 */
const PREVIEW_HOSTS: Partial<Record<SourceId, readonly string[]>> = {
  deezer: [".dzcdn.net"],
  apple: [".itunes.apple.com", ".mzstatic.com"],
  spotify: [".scdn.co"],
};

export function previewOn(source: SourceId, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = URL.parse(raw);
  const suffixes = PREVIEW_HOSTS[source] ?? [];
  const usable = url?.protocol === "https:" && suffixes.some((suffix) => url.hostname.endsWith(suffix));
  return usable ? raw : null;
}
