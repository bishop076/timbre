// What to do about a pause the player reported that nothing here pressed.
//
// `player-context.tsx` has been able to *recognise* one since the diagnostic landed: every
// pause from a press is stamped as it is sent, so a report arriving well after the last press
// is the source stopping by itself. It only said so in the log. This decides whether to put it
// back on, which is the thing a queue left alone actually needs — YouTube stops an embed that
// has played for a long stretch with nobody touching it, and a playlist that met that stopped
// dead until someone came back and pressed play.
//
// The whole difficulty is telling that apart from a pause the listener meant. A press inside a
// cross-origin iframe is invisible here — no click reaches this document — so the signal used
// instead is *when anything was last touched at all*, counting the document losing focus to an
// embed as a touch. Someone who just pressed pause in YouTube's own chrome interacted a moment
// ago; someone who walked away half an hour ago did not. Twenty seconds is the line, which is
// generous on the side of leaving playback alone: getting this wrong by resuming is far more
// annoying than getting it wrong by staying paused.
//
// The other half is *when* the pause arrived. Every embed reports its own startup as a flicker
// of pauses: Mixcloud's widget sends two within a second of being handed a cloudcast, and the
// player's own `getIsPaused()` answers `true` once more before autoplay takes. While someone is
// clicking about, the twenty-second rule swallows all of it. Leave the tab alone — which is what
// has happened by the time one track ends and the next one starts — and that rule has lapsed, so
// the *new* track's startup was read as the source stopping by itself and fought with a toggle.
// Two toggles inside a second and playback is off: "it pauses when the song ends and I'm not
// looking at the tab", exactly. So a source is given the length of the longest startup deadline
// any of them is held to before its pauses count for anything.

/** A pause reported within this of a local press is that press coming back. */
export const ASKED_MS = 1_000;

/** Recent enough that the listener is plainly still here, and the pause is theirs. */
export const QUIET_MS = 20_000;

/** This close to the end, the track is finishing; `handleEnded` owns what happens next. */
export const ENDING_SECONDS = 2;

/**
 * How long a source has to get going before a pause from it means anything. The longest deadline
 * any embed here is held to — YouTube's stall timer — so every one of them has finished its
 * handshake by the time this lapses. Nothing is lost by waiting: the pause this whole file exists
 * for comes from a source that has *played* for a long stretch, never from one still starting.
 */
export const SETTLING_MS = 10_000;

/** A source that keeps stopping is not being interrupted, it is refusing. Stop fighting it. */
export const MAX_RESUMES = 3;

/** Long enough for the embed to settle before it is asked to play again. */
export const RESUME_DELAY_MS = 400;

export interface PauseFacts {
  now: number;
  /** When a press here last asked for a pause or a play. */
  askedAt: number;
  /** When the page, or an embed inside it, was last touched. */
  interactedAt: number;
  /** When the source now playing was handed this track. */
  startedAt: number;
  position: number;
  duration: number;
  /**
   * When the source last reported that position — not when the number last changed. A hidden
   * tab clamps the progress poll to once a minute, so the two are very different things there.
   */
  readingAt: number;
  /** How many times this track has already been put back on. */
  resumes: number;
}

export type PauseVerdict = "asked" | "user" | "starting" | "ending" | "exhausted" | "resume";

/**
 * How far into the track the source actually is, which is not what it last said.
 *
 * The reading comes from a `setInterval` in each embed's player, and a tab in the background
 * has that clamped to once a minute — so at the moment a track ends, `position` can be most of
 * a minute short and "the track is ending" does not hold. That is the whole failure: a natural
 * end read as the source giving up, a rescue armed against it, and the toggle landing on the
 * *next* track's startup instead. Two toggles inside a second and playback is off.
 *
 * Playback was running right up to this pause — that is what `was === "playing"` means at the
 * only call site — so every millisecond since the reading was taken is a millisecond the track
 * advanced by. Adding it back is not a guess about the future, it is arithmetic about the past.
 *
 * Left uncapped: a reading stale enough to carry the estimate past `duration` only makes the
 * "ending" test truer, which is the direction this is allowed to be wrong in. Skipped entirely
 * when nothing has ever been reported, where `position` is 0 for want of news rather than
 * because the track is at its start.
 *
 * The bound on how wrong this can be is the poll itself: a background tab still reports once a
 * minute, so the estimate runs at most that far ahead. A source stalled in the middle of a long
 * track stays far enough from its end to be rescued, which is what the rest of this is for.
 */
function playedBy(now: number, position: number, readingAt: number): number {
  if (readingAt <= 0) return position;
  return position + Math.max(0, now - readingAt) / 1000;
}

export function judgePause(facts: PauseFacts): PauseVerdict {
  const { now, askedAt, interactedAt, startedAt, position, duration, readingAt, resumes } = facts;

  if (now - askedAt <= ASKED_MS) return "asked";
  if (now - interactedAt <= QUIET_MS) return "user";
  if (now - startedAt <= SETTLING_MS) return "starting";
  // Guard the subtraction as well as the comparison: a duration of 0 means the source never
  // reported one, and `0 - position` would read as "ending" for every such track.
  if (duration > 0 && duration - playedBy(now, position, readingAt) <= ENDING_SECONDS) {
    return "ending";
  }
  if (resumes >= MAX_RESUMES) return "exhausted";
  return "resume";
}

export function describeVerdict(verdict: PauseVerdict, resumes: number): string {
  switch (verdict) {
    case "user":
      return "left alone — someone was here a moment ago";
    case "starting":
      return "left alone — the source is still starting this track";
    case "ending":
      return "left alone — the track is ending";
    case "exhausted":
      return `left alone — already put back on ${MAX_RESUMES} times`;
    case "resume":
      return `putting it back on (${resumes + 1} of ${MAX_RESUMES})`;
    case "asked":
      return "asked for here";
  }
}
