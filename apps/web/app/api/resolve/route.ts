import { mergeTracks, resolveUrl } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { guard } from "@/lib/api";

/**
 * Turns a pasted URL into a song.
 *
 * The only way SoundCloud tracks enter Timbre: its catalogue search needs a paid
 * account and manual approval, while its player needs no credentials at all, so
 * a URL is the entry point. See `docs/BLOCKED.md`.
 *
 * Public and unauthenticated, like `/api/search` — Timbre is meant to be usable
 * from a link, without an account.
 */
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

  // No provider claimed the URL. A 404 rather than an error: the request was
  // well-formed, the link simply is not one Timbre can play.
  if (!track) {
    return Response.json(
      { error: "That link isn't from a service Timbre can play." },
      { status: 404 },
    );
  }

  // Through the merger even for one track, so the shape matches /api/search and
  // the client has a single Song type to handle.
  const [song] = mergeTracks([track]);
  return Response.json({ song });
}
