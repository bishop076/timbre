import { guard } from "@/lib/api";
import { allowed, capped, fetchAllowed, MAX_BYTES } from "@/lib/artwork-proxy";

function isRasterImage(contentType: string): boolean {
  const media = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  return media.startsWith("image/") && media !== "image/svg+xml";
}

/**
 * Nothing that went wrong is remembered. The `!upstream.ok` branch below learned that the hard
 * way — a burst of covers made Deezer start refusing and every placeholder that came back could
 * have been cached as the answer — and the rule was then written into that one branch and not
 * into the six around it. `https://i.ytimg.com/robots.txt` still left here as a bare 404 "Not an
 * image.", and a 404 is one of the statuses a shared cache may hold on a heuristic with no
 * directive telling it otherwise. The success path is `immutable` for a year; everything else is
 * this.
 */
function refuse(status: number, reason: string): Response {
  return new Response(reason, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const refusal = guard(request, "artwork");
  if (refusal) return refusal;

  const raw = new URL(request.url).searchParams.get("u");
  if (!raw) return refuse(400, "Missing url.");

  const target = URL.parse(raw);
  if (!target) return refuse(400, "Not a url.");
  if (!allowed(target)) return refuse(403, "Host not allowed.");

  const upstream = await fetchAllowed(target, { signal: request.signal }).catch(() => undefined);
  if (upstream === undefined) return refuse(502, "Upstream unreachable.");

  // `null` means the walk stopped: a redirect with no `location`, a loop, or a hop somewhere this
  // proxy does not follow. The host the *caller* named passed the allowlist two lines up — that
  // is why we fetched it — so answering "Host not allowed." sent them to check a URL that was
  // fine. Live: archive.org answers a missing cover with a 302 to `/images/notfound.png`, which
  // fails its path pin, which read back as the reader having asked for a forbidden host.
  if (upstream === null) return refuse(502, "Upstream redirected off the allowlist.");

  const type = upstream.headers.get("content-type") ?? "";

  // A CDN that refuses is not a cover that does not exist, and the two used to leave here as
  // the same 404 "Not an image." Found live: a burst of a dozen concurrent covers made Deezer
  // start refusing, every one came back 404, and `<Artwork>` drew the placeholder it draws for
  // a song with no art — the allowlist bug's symptom exactly, from a different cause. A reload a moment
  // later served all of them. Say which it was.
  if (!upstream.ok) {
    void upstream.body?.cancel();
    const missing = upstream.status === 404 || upstream.status === 410;
    return refuse(missing ? 404 : 502, missing ? "No such image." : "Upstream refused.");
  }

  if (!isRasterImage(type)) {
    void upstream.body?.cancel();
    return refuse(404, "Not an image.");
  }

  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    void upstream.body?.cancel();
    return refuse(413, "Too large.");
  }

  return new Response(capped(upstream.body, MAX_BYTES), {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
