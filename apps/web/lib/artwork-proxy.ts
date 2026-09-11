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
  "archive.org",
  "thumbnailer.mixcloud.com",
]);

export const MAX_BYTES = 8 * 1024 * 1024;

const MAX_HOPS = 3;

export function allowed(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
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
