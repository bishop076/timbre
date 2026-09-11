// Where a cover is fetched from, and how big a copy to ask for. Shared by every place that
// draws artwork — when only `artwork.tsx` applied these rules, Explore cost 2.5MB a load.

import { ALLOWED_HOSTS } from "@/lib/artwork-proxy";

/**
 * Rewrites artwork through Timbre's own origin. Content blockers filter by hostname and the
 * artwork CDNs are on enough lists that pictures silently disappear for anyone running one:
 * the URL is valid and answers 200, the request just never leaves the browser.
 *
 * **Only hosts `/api/art` will actually fetch.** The route enforces `ALLOWED_HOSTS` and
 * answers 403 otherwise, so rewriting an unlisted host turns a picture that would have
 * loaded into one that cannot — the two files have to agree, and importing the set is the
 * only way they agree by construction rather than by memory. Audius is why this matters:
 * its artwork is served by whichever content node holds the track — `v.monophonic.digital`,
 * `audius-content-11.figment.io`, `…theblueprint.xyz` — an operator-run set that changes,
 * so it cannot be enumerated in an allowlist whose job is to bound what the *server* will
 * fetch. Those covers load directly, which leaks nothing extra: the audio already streams
 * from the same nodes to the same browser.
 */
export function proxied(url: string | null | undefined): string | null {
  // Typed at runtime as well: stored songs have carried a number here, and `startsWith` on
  // one threw during render on every view that draws a cover (docs/SECURITY.md S-11).
  if (typeof url !== "string" || !url) return null;
  if (!url.startsWith("https://")) return url;

  try {
    if (!ALLOWED_HOSTS.has(new URL(url).hostname)) return url;
  } catch {
    return url;
  }

  return `/api/art?u=${encodeURIComponent(url)}`;
}

/** Deezer states dimensions in the path — `…/cover/<hash>/500x500-000000-80-0-0.jpg`. */
const DEEZER_DIMENSIONS = /\/(\d+)x(\d+)(-[^/]*)?\.(jpg|jpeg|png|webp)$/i;

/** Hosts that actually serve an arbitrary size on demand. **Matching the path shape is not
 * enough.** Audius covers end `/480x480.jpg`, which fits the pattern exactly — but its
 * content nodes serve only the three sizes the API names (150, 480, 1000) and answer **400**
 * for anything else, so asking for 112 replaced every Audius cover with a broken image. */
const RESIZABLE_HOSTS = /(^|\.)dzcdn\.net$/i;

/** A cover URL rewritten to ask for a `px`-wide copy — only ever downward, since asking for
 * more than the source offered buys an upscale: more bytes for a softer picture. */
export function sized(url: string | null | undefined, px: number): string | null {
  if (typeof url !== "string" || !url) return null;

  try {
    if (!RESIZABLE_HOSTS.test(new URL(url).hostname)) return url;
  } catch {
    return url;
  }

  return url.replace(DEEZER_DIMENSIONS, (whole, width: string, _height, rest, extension: string) =>
    Number(width) > px ? `/${px}x${px}${rest ?? ""}.${extension}` : whole,
  );
}

/** A cover, sized then proxied, so the `immutable` cache entry is keyed to the copy
 * actually shown. `px` is the drawn width in *device* pixels. */
export function cover(url: string | null | undefined, px: number): string | null {
  return proxied(sized(url, px));
}
