/**
 * When the ladder should stop walking a song's YouTube copies and leave YouTube.
 *
 * **A coded refusal is not always the upload's.** Codes 101 and 150 are documented as the
 * owner disabling embeds, which is per-upload, so another copy stands a chance — and for a
 * genuinely barred upload it often does. But measured 2026-09-10 from a Datacamp VPN exit,
 * every video returned 150, YouTube's own API sample included, because the player response
 * underneath was `LOGIN_REQUIRED: "Sign in to confirm that you're not a bot"`. The anonymous
 * first-party watch page from the same exit got the same answer. That is a refusal of the
 * address, and walking five more candidates at three seconds each only delays the preview.
 *
 * Nothing on this side can read that reason — it is inside a cross-origin iframe — so the
 * pattern is the only evidence: one refusal may be the upload, two different uploads of the
 * same song refused in a row points at the connection. B-18's stall is that verdict reached
 * on the first copy, because a 403 from the media server has no per-upload reading at all.
 * See docs/BUGS.md B-33.
 */

/** Distinct uploads of one song YouTube may refuse by code before the ladder leaves it. */
export const REFUSALS_BEFORE_LEAVING = 2;

export interface YouTubeFailures {
  /** A copy was accepted and never delivered media (B-18). */
  stalled: boolean;
  /** Distinct uploads of this song that answered 101, 150 or 153. */
  refusals: number;
}

/** Whether YouTube has turned away the connection rather than any one upload. */
export function turnedAway({ stalled, refusals }: YouTubeFailures): boolean {
  return stalled || refusals >= REFUSALS_BEFORE_LEAVING;
}
