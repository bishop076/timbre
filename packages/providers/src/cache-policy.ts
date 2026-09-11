import type { SearchContext } from "./types.ts";

export function cachePolicy(ctx: SearchContext): RequestInit {
  return ctx.revalidate === undefined
    ? { cache: "no-store" }
    : ({ next: { revalidate: ctx.revalidate } } as RequestInit);
}
