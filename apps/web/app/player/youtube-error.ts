/**
 * What the IFrame API's `onError` code means to the ladder.
 *
 * The table used to be read directly, and a code missing from it was reported as
 * `handleError(reason, false)` — and `false` is not "try the next copy", it is
 * `writeState("unplayable")` on the spot. So one unrecognised number ended the song with
 * SoundCloud, Audius and Archive all sitting there unasked. Code 2 is the plain case: it is
 * documented, it is what an invalid video id returns, and it was never in the table. Codes
 * outside the documented set happen too — 153 is in the table below and appears in none of
 * Google's docs, which is the proof that the set is not fixed and cannot be enumerated.
 *
 * So: every code is worth retrying. Nothing is lost by it — the ladder in `handleError` walks
 * a bounded list (`attempted` holds the ids tried, `spent` the sources) and, when it runs out,
 * gives up with a message written for the occasion, which is a better one than any of these.
 */
export const REFUSED = "YouTube wouldn't play this copy here.";

export interface ErrorVerdict {
  reason: string;
  /** Always true. Kept in the shape so the decision is a thing tests can hold. */
  worthRetrying: boolean;
  /** A refusal to embed *this copy*, which is what `youtube-refusal.ts` counts. */
  refused: boolean;
}

const MESSAGES: Record<number, string> = {
  2: "YouTube would not accept that video id.",
  5: "The player couldn't load this track.",
  100: "That upload has been removed.",
  101: REFUSED,
  150: REFUSED,
  153: REFUSED,
};

export function youtubeError(code: number): ErrorVerdict {
  const known = MESSAGES[code];
  return {
    reason: known ?? `YouTube couldn't play this copy (error ${code}).`,
    worthRetrying: true,
    refused: known === REFUSED,
  };
}
