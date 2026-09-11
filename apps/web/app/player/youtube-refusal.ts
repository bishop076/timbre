export const REFUSALS_BEFORE_LEAVING = 2;

export interface YouTubeFailures {
  stalled: boolean;
  refusals: number;
}

export function turnedAway({ stalled, refusals }: YouTubeFailures): boolean {
  return stalled || refusals >= REFUSALS_BEFORE_LEAVING;
}
