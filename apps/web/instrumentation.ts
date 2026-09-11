import type { Instrumentation } from "next";

import { describeError, log } from "@/lib/log";

/**
 * Every server error Next catches — a route handler that threw, a render that failed — as one
 * JSON line. See `lib/log.ts` for why a line on the console is the whole of the tracking.
 *
 * **What is logged, and why only that:**
 *
 * - `route` is the route *file*, `/artist/[name]` rather than `/artist/Some%20Band`. It is
 *   what finds the code, and the concrete path would say which artist somebody was reading
 *   about. `request.path` also carries the query string, which is where `/search` keeps what
 *   was typed — so it is not read at all.
 * - `kind` and `method` say whether it was a render, a route handler or an action, which
 *   decides where to look.
 * - `revalidate` is set when the error happened during background revalidation, when no
 *   reader was waiting on it.
 * - The error itself goes through `describeError`: name, a scrubbed message, the digest the
 *   reader's error screen shows, and the first five frames.
 *
 * Headers are never read: they carry the cookie that holds a display name and the
 * forwarded address that identifies a reader, and neither helps find a bug.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  log("error", "request_error", {
    route: context.routePath,
    kind: context.routeType,
    method: request.method,
    ...(context.revalidateReason ? { revalidate: context.revalidateReason } : {}),
    ...describeError(error),
  });
};
