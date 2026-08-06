import type { SearchContext } from "./types.ts";

/**
 * The fetch options that decide whether Next may cache an upstream response.
 *
 * One definition, because the two chart providers must agree: if Deezer's
 * responses are cacheable and Apple's are not, a page rendering both is still
 * dynamic and neither gets prerendered. That failure is silent — the page works,
 * it is simply served from scratch every time — which is exactly why it went
 * unnoticed and why this is not written out twice.
 *
 * See `SearchContext.revalidate` for why the default is `no-store` and when a
 * caller should override it.
 */
export function cachePolicy(ctx: SearchContext): RequestInit {
  if (ctx.revalidate === undefined) return { cache: "no-store" };

  // `next` is not in the DOM `RequestInit`, hence the cast: Next augments fetch
  // with it, and typing around that would mean redeclaring the global.
  return { next: { revalidate: ctx.revalidate } } as RequestInit;
}
