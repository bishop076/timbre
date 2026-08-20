import { z } from "zod";

/**
 * A user-supplied text parameter: trimmed, with blank treated as absent.
 *
 * `z.string().min(1)` counts a space. `?q=%20` therefore passed validation and fanned out
 * to every provider — Deezer answered `Wrong parameter`, the rest returned nothing, and the
 * deployment spent its shared per-minute quota on a query that could not match anything.
 * Apple's is about twenty requests a minute for *all* visitors, so queries that cannot
 * succeed are worth refusing before they are sent.
 *
 * Blank becomes `undefined` rather than `""` so that one rule serves both kinds of field: a
 * required one fails as though the parameter were missing, and an optional one is simply
 * not there — which is what a caller sending `?artist=%20` meant, and is friendlier than
 * failing the whole request over a parameter that was never needed.
 *
 * Kept out of `api.ts` for the same reason as `artwork-proxy.ts`: that module imports
 * `server-only`, which throws outside a server component, and this is worth testing.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" ? value.trim() || undefined : value;

/** Required: a blank parameter fails exactly as a missing one does. */
export function queryText(max: number) {
  return z.preprocess(blankToUndefined, z.string().max(max));
}

/**
 * Optional: a blank parameter is absent.
 *
 * `queryText(n).optional()` does **not** do this. `.optional()` wraps the preprocessor, so
 * it tests the *input* — `"  "` is defined, so it is passed through, trimmed to `undefined`,
 * and then fails the inner string. The optional has to be built inside the effect instead.
 */
export function optionalQueryText(max: number) {
  return z.preprocess(blankToUndefined, z.string().max(max).optional());
}
