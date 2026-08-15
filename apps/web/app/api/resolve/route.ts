import { mergeTracks, resolveUrl } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { guard } from "@/lib/api";

// Turns a pasted URL into a song — the only way SoundCloud tracks enter Timbre, since its
// search needs a paid account while its player needs none. See `docs/BLOCKED.md`.
export const dynamic = "force-dynamic";

const querySchema = z.object({
  url: z.url({ error: "A track URL is required." }).max(2000),
});

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ url: url.searchParams.get("url") });

  if (!parsed.success) {
    return Response.json(
      { error: "A valid track URL is required.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { limiter } = getProviderRuntime();
  const track = await resolveUrl({ limiter, signal: request.signal }, parsed.data.url);

  // No provider claimed the URL — a 404, since the request was well-formed.
  if (!track) {
    return Response.json(
      { error: "That link isn't from a service Timbre can play." },
      { status: 404 },
    );
  }

  // Through the merger even for one track, so the client has one Song shape.
  const [song] = mergeTracks([track]);
  return Response.json({ song });
}
