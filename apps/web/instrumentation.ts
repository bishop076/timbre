import type { Instrumentation } from "next";

import { describeError, log } from "@/lib/log";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  log("error", "request_error", {
    route: context.routePath,
    kind: context.routeType,
    method: request.method,
    ...(context.revalidateReason ? { revalidate: context.revalidateReason } : {}),
    ...describeError(error),
  });
};
