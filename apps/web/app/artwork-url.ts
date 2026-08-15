// Where a cover is fetched from, and how big a copy to ask for. Shared by every place that
// draws artwork — when only `artwork.tsx` applied these rules, Explore cost 2.5MB a load.

/**
 * Rewrites artwork through Timbre's own origin. Content blockers filter by hostname and the
 * artwork CDNs are on enough lists that pictures silently disappear for anyone running one:
 * the URL is valid and answers 200, the request just never leaves the browser.
 */
export function proxied(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith("https://")) return url;
  return `/api/art?u=${encodeURIComponent(url)}`;
}

/** Deezer states dimensions in the path — `…/cover/<hash>/500x500-000000-80-0-0.jpg`. */
const DEEZER_DIMENSIONS = /\/(\d+)x(\d+)(-[^/]*)?\.(jpg|jpeg|png|webp)$/i;

/** A cover URL rewritten to ask for a `px`-wide copy — only ever downward, since asking for
 * more than the source offered buys an upscale: more bytes for a softer picture. */
export function sized(url: string | null | undefined, px: number): string | null {
  if (!url) return null;

  return url.replace(DEEZER_DIMENSIONS, (whole, width: string, _height, rest, extension: string) =>
    Number(width) > px ? `/${px}x${px}${rest ?? ""}.${extension}` : whole,
  );
}

/** A cover, sized then proxied, so the `immutable` cache entry is keyed to the copy
 * actually shown. `px` is the drawn width in *device* pixels. */
export function cover(url: string | null | undefined, px: number): string | null {
  return proxied(sized(url, px));
}
