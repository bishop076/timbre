import { mergeTracks, resolveUrl } from "@timbre/providers";
import { z } from "zod";

import { queryRoute, reportFailures } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

export const GET = queryRoute(
  z.object({ url: z.url({ protocol: /^https?$/, error: "A track URL is required." }).max(2000) }),
  "A valid track URL is required.",
  async ({ url }, request) => {
    const { track, failures } = await resolveUrl(
      {
        ...getProviderRuntime(),
        signal: request.signal,
        report: (event, fields) => log("warn", event, { route: "/api/resolve", ...fields }),
      },
      url,
    );
    if (track) return Response.json({ song: mergeTracks([track])[0] });

    // A provider that threw is not a provider that declined. Blaming the reader's link for an
    // outage sent them off to check a URL that was fine.
    if (failures.length > 0) {
      reportFailures("/api/resolve", failures);
      return Response.json(
        {
          error: "Timbre couldn't reach the service this link belongs to. Try again shortly.",
          failures,
        },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { error: "That link isn't from a service Timbre can play." },
      { status: 404 },
    );
  },
  { issues: true },
);
