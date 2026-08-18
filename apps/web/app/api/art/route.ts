/*
 * Cover art from Timbre's own origin. Content blockers filter by hostname, and
 * `i.ytimg.com` is on enough lists that artwork silently vanished for anyone running one
 * — another YouTube url cannot help, since the host is what is blocked. Allowlisted
 * deliberately: fetching any url handed in is an SSRF hole. https and images only.
 *
 * The fetching itself lives in `lib/artwork-proxy.ts`, where it can be tested. What is
 * left here is the request: metering, parsing, and the response.
 */

import { guardArtwork } from "@/lib/api";
import { allowed, capped, fetchAllowed, MAX_BYTES } from "@/lib/artwork-proxy";

export async function GET(request: Request) {
  // Artwork has its own budget, well above what a page needs and well below a scraper —
  // the allowlist bounds which hosts can be reached, never how often. See EXPOSURE.md E-7.
  const refusal = guardArtwork(request);
  if (refusal) return refusal;

  const raw = new URL(request.url).searchParams.get("u");
  if (!raw) return new Response("Missing url.", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Not a url.", { status: 400 });
  }

  if (!allowed(target)) {
    return new Response("Host not allowed.", { status: 403 });
  }

  let upstream: Response | null;
  try {
    upstream = await fetchAllowed(target, { signal: request.signal });
  } catch {
    return new Response("Upstream unreachable.", { status: 502 });
  }

  // A redirect that left the allowlist. Refused exactly as though the host it landed on
  // had been asked for directly, which is what it amounts to.
  if (!upstream) return new Response("Host not allowed.", { status: 403 });

  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !type.startsWith("image/")) {
    // Non-images are refused, or this becomes a relay for whatever else those hosts serve.
    return new Response("Not an image.", { status: 404 });
  }

  // The declared length is an early-out, not the enforcement. It used to be both, so a
  // response announcing a modest `content-length` and then sending far more streamed
  // through unmetered — leaving the cap in the hands of whoever answered. Metering always
  // costs one comparison per chunk. See docs/EXPOSURE.md, E-9.
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return new Response("Too large.", { status: 413 });
  }

  return new Response(capped(upstream.body, MAX_BYTES), {
    headers: {
      "content-type": type,
      // Artwork for a url never changes, so the proxy leaves the critical path.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
