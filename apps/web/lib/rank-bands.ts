// The rank bands a chart entry is bucketed into, beside the bucketing so the labels cannot
// drift from the arithmetic. Deliberately without `server-only`: the names are needed on
// both sides, and a value imported from a `server-only` module drags that module into the
// client bundle, which Next refuses. Types cross freely; a `const` array does not.

export const RANK_BANDS = ["1–25", "26–50", "51–75", "76–100"] as const;

/** Which band a 1-based chart position falls in. */
export function bandOf(position: number): number {
  // Clamped: a ranking longer than a hundred must not index past the last band.
  return Math.min(RANK_BANDS.length - 1, Math.max(0, Math.floor((position - 1) / 25)));
}
