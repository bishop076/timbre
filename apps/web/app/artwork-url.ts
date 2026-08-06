/**
 * Where a cover is fetched from, and how big a copy to ask for.
 *
 * Both rules were already in the codebase and only `artwork.tsx` was applying
 * them. Every other place that draws a cover — the collage, the Explore hero,
 * the collection and rankings rows — reached the CDN directly with a raw `<img>`
 * and took whatever size the source happened to hand back. That cost Explore
 * about 2.5MB of pictures per load and quietly reopened the bug the proxy exists
 * to close, so the rules live here now and everything shares them.
 */

/**
 * Rewrites artwork through Timbre's own origin.
 *
 * Content blockers filter by hostname, and the CDNs that serve music artwork are
 * on enough lists that pictures silently disappear for anyone running one — the
 * urls are perfectly valid and answer 200 from a server, the request simply never
 * leaves the browser. A first-party path matches no blocklist.
 *
 * The proxy allowlists hosts, so an unrecognised url is left alone rather than
 * handed to an endpoint that would refuse it anyway.
 */
export function proxied(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith("https://")) return url;
  return `/api/art?u=${encodeURIComponent(url)}`;
}

/**
 * Deezer states the dimensions in the path, so a smaller copy costs one string.
 *
 * `…/cover/<hash>/500x500-000000-80-0-0.jpg` — every cover comes back at 500×500
 * whatever it is going to be drawn at, and Explore draws most of them at well
 * under a hundred pixels: five tiles at 30% of a small card, and a backdrop so
 * heavily blurred that its resolution cannot be seen at all. A 500×500 JPEG is
 * around 50KB and there are fifty-odd of them on that page.
 *
 * **Only ever downward.** Asking for a larger copy than the source offered would
 * request an upscale — more bytes for a softer picture — so a url already at or
 * below the target is left exactly as it is, as is any url whose shape this does
 * not recognise. Unknown hosts pass through untouched rather than being guessed
 * at.
 */
const DEEZER_DIMENSIONS = /\/(\d+)x(\d+)(-[^/]*)?\.(jpg|jpeg|png|webp)$/i;

export function sized(url: string | null | undefined, px: number): string | null {
  if (!url) return null;

  return url.replace(DEEZER_DIMENSIONS, (whole, width: string, _height, rest, extension: string) =>
    Number(width) > px ? `/${px}x${px}${rest ?? ""}.${extension}` : whole,
  );
}

/**
 * A cover, at the size it will be drawn and through Timbre's own origin.
 *
 * The order matters: the size is chosen first so the proxy is asked for the copy
 * that will actually be shown, and its `immutable` cache entry is keyed to that
 * copy rather than to a full-size one nobody displays.
 *
 * `px` is the **drawn** width in device pixels, so pass roughly twice the CSS
 * size for a retina screen. Overshooting a little is cheap; undershooting is
 * visible.
 */
export function cover(url: string | null | undefined, px: number): string | null {
  return proxied(sized(url, px));
}
