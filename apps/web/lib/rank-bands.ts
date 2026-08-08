/**
 * The rank bands a chart entry is bucketed into.
 *
 * **Deliberately without `server-only`.** The names are needed on both sides —
 * the server buckets by them, the legend labels by them — and a value imported
 * from a `server-only` module drags that whole module into the client bundle,
 * which Next refuses outright. Types are erased at compile time and cross
 * freely; a `const` array does not.
 *
 * Kept beside the bucketing rather than restated in the view, so the labels
 * cannot drift from the arithmetic that produces them.
 */

export const RANK_BANDS = ["1–25", "26–50", "51–75", "76–100"] as const;

/** Which band a 1-based chart position falls in. */
export function bandOf(position: number): number {
  // Clamped, so a ranking longer than a hundred cannot index past the last band.
  return Math.min(RANK_BANDS.length - 1, Math.max(0, Math.floor((position - 1) / 25)));
}
