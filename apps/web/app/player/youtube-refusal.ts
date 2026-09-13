export const REFUSALS_BEFORE_LEAVING = 2;

export interface YouTubeFailures {
  /** The IFrame API script never arrived — an ad blocker, or a network filter. */
  blocked: boolean;
  stalled: boolean;
  refusals: number;
}

/** Why the ladder should stop asking YouTube. */
export type LeftYouTube = "blocked" | "refused";

/**
 * `blocked` is the harder of the two verdicts, and the reason this is not a boolean. A refused
 * or stalled copy still leaves a player object behind, so another id would at least report back;
 * a blocked script leaves none, and `YouTubePlayer.start` no-ops without one. Trying a second
 * copy in that state does not fail — it hangs at "loading" with nothing left to raise an error.
 */
export function whyLeftYouTube({
  blocked,
  stalled,
  refusals,
}: YouTubeFailures): LeftYouTube | null {
  if (blocked) return "blocked";
  if (stalled || refusals >= REFUSALS_BEFORE_LEAVING) return "refused";
  return null;
}
