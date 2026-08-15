/*
 * Cover art from Timbre's own origin. Content blockers filter by hostname, and
 * `i.ytimg.com` is on enough lists that artwork silently vanished for anyone running one
 * — another YouTube url cannot help, since the host is what is blocked. Allowlisted
 * deliberately: fetching any url handed in is an SSRF hole. https and images only.
 */

/** Hosts whose artwork Timbre already displays. Nothing else is fetchable. */
const ALLOWED_HOSTS = new Set([
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
]);

/** Artwork is small. Anything larger is not artwork. */
const MAX_BYTES = 8 * 1024 * 1024;

/** Passes a body through, erroring past `limit`. Cancel the source, don't ignore it, or the socket stays open. */
function capped(body: ReadableStream<Uint8Array> | null, limit: number): ReadableStream<Uint8Array> | null {
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

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("u");
  if (!raw) return new Response("Missing url.", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Not a url.", { status: 400 });
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return new Response("Host not allowed.", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // No cookies, credentials or caller headers: this request is Timbre's.
      headers: { accept: "image/*" },
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("Upstream unreachable.", { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.startsWith("image/")) {
    // Non-images are refused, or this becomes a relay for whatever else those hosts serve.
    return new Response("Not an image.", { status: 404 });
  }

  // The cap must survive a missing `content-length`: `Number(header ?? 0)` made a chunked
  // response measure zero bytes and stream through unbounded, so an absent header means
  // metering the body rather than trusting the number.
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return new Response("Too large.", { status: 413 });
  }

  const body =
    Number.isFinite(declared) && declared > 0 ? upstream.body : capped(upstream.body, MAX_BYTES);

  return new Response(body, {
    headers: {
      "content-type": type,
      // Artwork for a url never changes, so the proxy leaves the critical path.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
