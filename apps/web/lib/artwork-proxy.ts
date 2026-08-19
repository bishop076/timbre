// The fetching half of `/api/art`, kept out of the route so it can be tested. No
// `server-only` guard, for the same reason as `cache.ts` and `rate-limit.ts`: that import
// throws outside a server component, and this is the part most worth exercising.

/** Hosts whose artwork Timbre already displays. Nothing else is fetchable. */
export const ALLOWED_HOSTS = new Set([
  "i.ytimg.com",
  "i9.ytimg.com",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
  "music.youtube.com",
  "cdn-images.dzcdn.net",
  "e-cdns-images.dzcdn.net",
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
  "i1.sndcdn.com",
  // The Live Music Archive's item tiles. Safe to name where Audius's are not: this is one
  // stable host that Archive itself runs, while Audius artwork is served by whichever
  // operator-run content node holds the track and the set changes.
  "archive.org",
  // Mixcloud serves every cover through one thumbnailer, so it can be named the way
  // archive.org can and Audius cannot.
  "thumbnailer.mixcloud.com",
]);

/** Artwork is small. Anything larger is not artwork. */
export const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Enough to follow a CDN moving an object, not enough to be a tour. Three is more than any
 * of these hosts has ever needed.
 */
export const MAX_HOPS = 3;

/** Whether a URL is one this proxy will fetch. Applied to **every** hop, not just the first. */
export function allowed(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
}

/** Passes a body through, erroring past `limit`. Cancel the source, don't ignore it, or the socket stays open. */
export function capped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;

  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          controller.error(new Error("Artwork exceeded the size limit."));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Injectable so a test does not have to serve from one of the real CDNs. */
  isAllowed?: (url: URL) => boolean;
  maxHops?: number;
}

/**
 * Fetches `target`, following redirects **only** to hosts that pass the same check.
 *
 * `fetch` defaults to `redirect: "follow"`, which meant the allowlist was applied once — to
 * the URL supplied — and never to wherever the chain ended. An open redirect on any one of
 * the fourteen hosts above therefore turned the allowlist into a suggestion. Following the
 * chain by hand is the only way to re-check it: there is no per-hop callback.
 *
 * See docs/SECURITY.md, S-5.
 *
 * Returns null when a hop is refused, so a blocked redirect is indistinguishable from a
 * host that was never allowed in the first place.
 */
export async function fetchAllowed(
  target: URL,
  { signal, isAllowed = allowed, maxHops = MAX_HOPS }: FetchOptions = {},
): Promise<Response | null> {
  let current = target;

  for (let hop = 0; hop <= maxHops; hop += 1) {
    const response = await fetch(current, {
      // No cookies, credentials or caller headers: this request is Timbre's.
      headers: { accept: "image/*" },
      signal,
      cache: "no-store",
      redirect: "manual",
    });

    // 304 is in the 300s and is not a redirect. `cache: "no-store"` should put it out of
    // reach, but treating it as one would mean following an absent `location`.
    if (response.status === 304 || response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return null;

    let next: URL;
    try {
      // Resolved against the current URL: `location` may be relative, and a relative hop
      // landing back on an allowed host is perfectly ordinary.
      next = new URL(location, current);
    } catch {
      return null;
    }

    if (!isAllowed(next)) return null;
    current = next;
  }

  // Out of hops. A chain this long is not a CDN moving an object.
  return null;
}
