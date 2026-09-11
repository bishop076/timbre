import { guardArtwork } from "@/lib/api";
import { allowed, capped, fetchAllowed, MAX_BYTES } from "@/lib/artwork-proxy";

function isRasterImage(contentType: string): boolean {
  const media = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return media.startsWith("image/") && media !== "image/svg+xml";
}

export async function GET(request: Request) {
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

  if (!upstream) return new Response("Host not allowed.", { status: 403 });

  const type = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !isRasterImage(type)) {
    void upstream.body?.cancel();
    return new Response("Not an image.", { status: 404 });
  }

  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    void upstream.body?.cancel();
    return new Response("Too large.", { status: 413 });
  }

  return new Response(capped(upstream.body, MAX_BYTES), {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
