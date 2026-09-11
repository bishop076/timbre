import { mergeTracks, resolveUrl } from "@timbre/providers";
import { z } from "zod";

import { queryRoute } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";

export const dynamic = "force-dynamic";

export const GET = queryRoute(
  z.object({ url: z.url({ error: "A track URL is required." }).max(2000) }),
  "A valid track URL is required.",
  async ({ url }, request) => {
    const track = await resolveUrl({ ...getProviderRuntime(), signal: request.signal }, url);
    if (!track) {
      return Response.json(
        { error: "That link isn't from a service Timbre can play." },
        { status: 404 },
      );
    }
    return Response.json({ song: mergeTracks([track])[0] });
  },
  { issues: true },
);
