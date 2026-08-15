import type { SearchContext } from "./types.ts";

/**
 * The fetch options that decide whether Next may cache an upstream response. One
 * definition, because the chart providers must agree: if one is cacheable and the other is
 * not, a page rendering both stays dynamic and neither gets prerendered — a silent failure,
 * since the page still works. Default is `no-store`; see `SearchContext.revalidate`.
 */
export function cachePolicy(ctx: SearchContext): RequestInit {
  if (ctx.revalidate === undefined) return { cache: "no-store" };

  // `next` is not in the DOM `RequestInit`, hence the cast.
  return { next: { revalidate: ctx.revalidate } } as RequestInit;
}
