/** Covers the whole walk, redirects included — a stalled hop is the failure being bounded. */
const FETCH_DEADLINE_MS = 6_000;

export const ALLOWED_HOSTS = new Set([
  "i.ytimg.com",
  "i9.ytimg.com",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
  // `music.youtube.com` was here and is not an image host — it is the YouTube Music web app,
  // and no provider in this repo ever mints an artwork URL on it (covers come from ytimg,
  // ggpht and googleusercontent above). Listed with no `ALLOWED_PATHS` entry it accepted any
  // path, which is precisely the lever the note below this list exists to close. If a cover
  // ever does turn up on that host it draws the placeholder, which is visible and reversible;
  // an unbounded app host on an image allowlist is neither.
  "cdn-images.dzcdn.net",
  "e-cdns-images.dzcdn.net",
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
  "i1.sndcdn.com",
  "i.scdn.co",
  "image-cdn-ak.spotifycdn.com",
  "image-cdn-fa.spotifycdn.com",
  // Spotify serves anything that is not a plain album cover — mixes, blends, editorial and
  // mosaic art — from these instead. Without them the picture loads but the accent cannot.
  "mosaic.scdn.co",
  "thisis-images.scdn.co",
  "daily-mix.scdn.co",
  "dailymix-images.scdn.co",
  "newjams-images.scdn.co",
  "seeded-session-images.scdn.co",
  "seed-mix-image.spotifycdn.com",
  "blend-playlist-covers.spotifycdn.com",
  // song-shape.ts rewrites Audius covers to this host.
  "api.audius.co",
  "archive.org",
  "thumbnailer.mixcloud.com",
]);

// Two of the hosts above are not image CDNs: they answer an API on the same name. The
// allowlist is a host list and `/api/art` accepts any path on a listed host, so without
// this the proxy is a lever for pointing the server at someone else's API. Nothing comes
// back — the route returns 404 unless the reply is a raster image — but the request still
// goes, which is a bound worth keeping tight. Both shapes are the ones the providers
// actually mint: archive.ts:70 and song-shape.ts's Audius rewrite.
export const ALLOWED_PATHS: Record<string, RegExp> = {
  "api.audius.co": /^\/content\/[A-Za-z0-9]+\/(?:150x150|480x480|1000x1000)\.jpg$/,
  "archive.org": /^\/services\/img\/[^/]+$/,
};

// A path pattern bounds *segments*, and `new URL` leaves `%2f` and `%5c` encoded rather than
// decoding them — so `[^/]+` happily matched `x%2f..%2f..%2fmetadata%2fy`, a value carrying the
// separator the pattern exists to exclude. Whether the host then decodes it back into one is
// the host's business: archive.org answers 404 today, which is a behaviour and not a promise.
// Refuse the encoded forms here so each pattern bounds what it reads as bounding.
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

function matchesPath(pathname: string, pattern: RegExp): boolean {
  return !ENCODED_SEPARATOR.test(pathname) && pattern.test(pathname);
}

// `api.audius.co` is a directory, not a CDN: asked for a cover it answers 307 to whichever
// community node happens to hold it — v.monophonic.digital, cn1.mainnet.audiusindex.org, a
// set nobody can enumerate and so nobody can allowlist. Refusing that hop, which is the right
// rule for every other host here, is why every Audius cover came back 403.
//
// Following it is safe in the one way that matters, and it is worth being precise about why:
// the leak this proxy exists to stop is the *browser* fetching from an unvetted host, which
// hands that host the reader's address and user agent. A hop taken server-side hands it
// nothing about the reader. The bound kept instead is the path — the redirect has to still be
// asking for the same shape of cover — so a caller can never steer this anywhere beyond a
// cover they could already have named directly.
const FOLLOWS_OFFSITE: Record<string, RegExp> = {
  "api.audius.co": /^\/content\/[A-Za-z0-9]+\/(?:150x150|480x480|1000x1000)\.jpg$/,
};

// Belt and braces on the hop above: a redirect must not be able to point the server at
// something only the server can reach. `\[` covers every IPv6 literal at once, brackets and
// all, which is how `URL` reports one — `::1` and `::ffff:127.0.0.1` included.
//
// Be clear about the shape of this control, because it is easy to read as more than it is:
// it filters *literal addresses*, so it cannot catch a hostname that resolves into private
// space, nor the alternate encodings of one (`https://2130706433/`). What actually carries
// the weight is the company it keeps — https, so a TLS handshake with a metadata service or
// a bare address fails on the certificate; the path pin, so the request can only ever ask for
// a cover; and `/api/art` returning nothing that is not a raster image. This list is the
// cheap half of that, not the load-bearing half.
const PRIVATE_HOST =
  /^(?:localhost|\[|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/i;

function followableOffsite(next: URL, path: RegExp): boolean {
  return (
    next.protocol === "https:" &&
    !PRIVATE_HOST.test(next.hostname) &&
    matchesPath(next.pathname, path)
  );
}

export const MAX_BYTES = 8 * 1024 * 1024;

const MAX_HOPS = 3;

export function allowed(url: URL): boolean {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return false;
  const path = ALLOWED_PATHS[url.hostname];
  return path === undefined || matchesPath(url.pathname, path);
}

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
        if (seen > limit) controller.error(new Error("Artwork exceeded the size limit."));
        else controller.enqueue(chunk);
      },
    }),
  );
}

export async function fetchAllowed(
  target: URL,
  { signal, isAllowed = allowed }: { signal?: AbortSignal; isAllowed?: (url: URL) => boolean } = {},
): Promise<Response | null> {
  let current = target;
  // Keyed on where the request started, not on where it has got to — and *spent the first time
  // it is used*, which is the half that was missing. Keying alone left this truthy for every
  // iteration, so a node that redirected to a second node redirected to a third was followed
  // all the way to MAX_HOPS: three hops off the allowlist, not the one this comment claimed.
  // The tests did not catch it because every case stubbed a single redirect.
  //
  // `api.audius.co` may hand the walk to the node holding the cover. That node may hand it
  // back to an allowlisted host — `isAllowed` still says yes below — but it may not hand it
  // onward to another unvetted one.
  let offsite: RegExp | undefined = FOLLOWS_OFFSITE[target.hostname];

  // The only outbound fetch in the app with no deadline of its own — and it runs up to four
  // times per request. Every other caller bounds itself (`request.ts`, `/api/health`,
  // `lib/deezer.ts`, `/api/lyrics`, all 6s or less), so an allowlisted CDN that accepts the
  // connection and then stalls held a server slot until the platform gave up on it, at 300
  // requests a minute per address.
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_DEADLINE_MS)])
    : AbortSignal.timeout(FETCH_DEADLINE_MS);

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const response = await fetch(current, {
      headers: { accept: "image/*" },
      signal: deadline,
      cache: "no-store",
      redirect: "manual",
    });

    if (response.status === 304 || response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    const next = location ? URL.parse(location, current) : null;
    if (!next) return null;
    if (!isAllowed(next)) {
      if (!offsite || !followableOffsite(next, offsite)) return null;
      offsite = undefined;
    }
    current = next;
  }

  return null;
}
