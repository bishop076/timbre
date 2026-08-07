/**
 * Cover art, served from Timbre's own origin.
 *
 * Content blockers filter by hostname, and `i.ytimg.com` is on enough lists
 * that artwork silently vanished for anyone running one — confirmed: the
 * pictures come back the moment the blocker is switched off. Every url is
 * valid and answers 200 from a server; the request simply never leaves the
 * browser. Retrying a different YouTube url cannot help, because the host is
 * what is blocked.
 *
 * Fetching it here and passing it on makes the browser's request first-party,
 * which no blocklist matches. Timbre stores nothing and re-hosts nothing — the
 * bytes are fetched per request and cached by the browser, exactly as they
 * would have been coming from the CDN directly.
 *
 * **This is an allowlisted proxy, deliberately.** An endpoint that fetches
 * whatever url it is handed is an SSRF hole: it would reach private addresses,
 * cloud metadata endpoints and anything else inside the network, using this
 * server's own credentials and position. So only known artwork CDNs are
 * fetchable, only over https, and only image responses are returned.
 */

/** Hosts whose artwork Timbre already displays. Nothing else is fetchable. */
const ALLOWED_HOSTS = new Set([
  // YouTube / YouTube Music
  "i.ytimg.com",
  "i9.ytimg.com",
  "yt3.ggpht.com",
  "yt3.googleusercontent.com",
  "lh3.googleusercontent.com",
  "music.youtube.com",
  // Deezer
  "cdn-images.dzcdn.net",
  "e-cdns-images.dzcdn.net",
  // Apple
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
  // SoundCloud, for when it ships
  "i1.sndcdn.com",
]);

/** Artwork is small. Anything larger is not artwork. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Passes a body through, abandoning it if it exceeds `limit`.
 *
 * Only used when the upstream declared no length. Cancelling the source rather
 * than merely stopping the copy matters: an abandoned stream that is still being
 * read holds a socket open for as long as the far end keeps sending.
 */
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
      // No cookies, no credentials, and none of the caller's headers: this
      // request is Timbre's, not the visitor's.
      headers: { accept: "image/*" },
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("Upstream unreachable.", { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.startsWith("image/")) {
    // Anything that is not an image is not passed on — that is what stops this
    // being a general-purpose relay for whatever those hosts also serve.
    return new Response("Not an image.", { status: 404 });
  }

  /*
   * The cap has to survive a missing `content-length`.
   *
   * It read `Number(header ?? 0)`, so an upstream that answered with a chunked
   * response — no length at all — measured as zero bytes and was streamed
   * straight through unbounded. The header is still trusted when present, because
   * refusing early is cheaper than counting; when it is absent the body is
   * metered as it passes and cut off if it runs over.
   */
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return new Response("Too large.", { status: 413 });
  }

  const body =
    Number.isFinite(declared) && declared > 0 ? upstream.body : capped(upstream.body, MAX_BYTES);

  return new Response(body, {
    headers: {
      "content-type": type,
      // Artwork for a given url never changes, so let the browser keep it and
      // stop asking. This is what keeps the proxy off the critical path after
      // the first view.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
