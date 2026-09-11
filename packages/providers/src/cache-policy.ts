import type { SearchContext } from "./types.ts";

export function cachePolicy(ctx: SearchContext): RequestInit {
  if (ctx.revalidate === undefined) return { cache: "no-store" };

  return { next: { revalidate: ctx.revalidate } } as RequestInit;
}
