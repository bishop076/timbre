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

export const MAX_BYTES = 8 * 1024 * 1024;

const MAX_HOPS = 3;

export function allowed(url: URL): boolean {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return false;
  const path = ALLOWED_PATHS[url.hostname];
  return path === undefined || path.test(url.pathname);
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

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const response = await fetch(current, {
      headers: { accept: "image/*" },
      signal,
      cache: "no-store",
      redirect: "manual",
    });

    if (response.status === 304 || response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    const next = location ? URL.parse(location, current) : null;
    if (!next || !isAllowed(next)) return null;
    current = next;
  }

  return null;
}
