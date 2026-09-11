export const RANK_BANDS = ["1–25", "26–50", "51–75", "76–100"] as const;

export function bandOf(position: number): number {
  return Math.min(RANK_BANDS.length - 1, Math.max(0, Math.floor((position - 1) / 25)));
}
