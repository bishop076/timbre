import { guard } from "@/lib/api";
import { allowed, capped, fetchAllowed, MAX_BYTES } from "@/lib/artwork-proxy";

function isRasterImage(contentType: string): boolean {
  const media = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return media.startsWith("image/") && media !== "image/svg+xml";
}

export async function GET(request: Request) {
  const refusal = guard(request, "artwork");
  if (refusal) return refusal;

  const raw = new URL(request.url).searchParams.get("u");
  if (!raw) return new Response("Missing url.", { status: 400 });

  const target = URL.parse(raw);
  if (!target) return new Response("Not a url.", { status: 400 });
  if (!allowed(target)) return new Response("Host not allowed.", { status: 403 });

  const upstream = await fetchAllowed(target, { signal: request.signal }).catch(() => undefined);
  if (upstream === undefined) return new Response("Upstream unreachable.", { status: 502 });
  if (upstream === null) return new Response("Host not allowed.", { status: 403 });

  const type = upstream.headers.get("content-type") ?? "";

  // A CDN that refuses is not a cover that does not exist, and the two used to leave here as
  // the same 404 "Not an image." Found live: a burst of a dozen concurrent covers made Deezer
  // start refusing, every one came back 404, and `<Artwork>` drew the placeholder it draws for
  // a song with no art — B-37's symptom exactly, from a different cause. A reload a moment
  // later served all of them. Say which it was, and never let a refusal be cached as an
  // answer: the success path below is `immutable` for a year.
  if (!upstream.ok) {
    void upstream.body?.cancel();
    const missing = upstream.status === 404 || upstream.status === 410;
    return new Response(missing ? "No such image." : "Upstream refused.", {
      status: missing ? 404 : 502,
      headers: { "cache-control": "no-store" },
    });
  }

  if (!isRasterImage(type)) {
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
