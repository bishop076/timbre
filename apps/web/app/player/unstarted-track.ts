/**
 * What to do about a source that answered a track with a pause it never played.
 *
 * `unasked-pause.ts` next door judges a pause that *interrupted* playback, and it is deaf to this
 * one twice over: its only caller asks it solely when the player was `playing` a moment ago, and
 * `SETTLING_MS` then gives every source ten seconds of startup flicker before a pause from it
 * counts for anything at all. Between those two rules a track the browser or the embed simply
 * refused to start is never judged. `player-context.tsx` wrote the pause down and that was the
 * end of it — no deadline, no log line, no rung of the ladder. The queue stopped between two
 * songs and said nothing, for as long as the tab stayed open.
 *
 * Every player reaches this the same way. `progressive-audio-player.tsx` catches the element's
 * `NotAllowedError` and reports "paused"; `mixcloud-player.tsx` asks `getIsPaused()` after its
 * own `play()` and reports whatever it says; `youtube-player.tsx` maps `CUED` to "paused". Three
 * different refusals, one indistinguishable report, and nothing downstream watching for it.
 *
 * So the question is asked from a clock rather than from the report: a source that was handed a
 * track and is still sitting paused when this lapses never started it. Only two things are
 * allowed to mean otherwise — audio having arrived, and a press here.
 */

/**
 * How long a source has to get a track going before "it never started" is the answer.
 *
 * Measured from the pause, not from the handover, and only ever while the player is *settled*
 * on one: a source still handshaking leaves the state at `loading`, where each player's own
 * deadline owns it. This only judges a source that spoke promptly and said "paused", so it can
 * be the length of the longest startup any of them reports through — `SETTLING_MS` next door —
 * rather than the length of the slowest handshake.
 */
export const UNSTARTED_MS = 10_000;

/** A source that will not start is not being interrupted. Two goes, then the ladder. */
export const MOST_RESTARTS = 2;

export interface StartFacts {
  /** Whether audio has arrived for this attempt — `handleStateChange("playing")`, which since
   *  the stall fix means the stream, not the call to `play()`. */
  played: boolean;
  /** When a press here last asked for a pause or a play. */
  askedAt: number;
  /** When the source now playing was handed this track. */
  startedAt: number;
  /** How many times this pause has already been asked to start again. */
  restarts: number;
}

export type StartVerdict = "played" | "asked" | "restart" | "refused";

export function judgeStart({ played, askedAt, startedAt, restarts }: StartFacts): StartVerdict {
  // A track that has played is a track someone can pause, and pausing it is the whole point of
  // the button. Whatever stops it after that belongs to `unasked-pause.ts`.
  if (played) return "played";
  // A press that landed after this source was handed the track is the reason it is paused —
  // pausing a song while it is still loading is a thing people do, and fighting it is rude.
  if (askedAt >= startedAt) return "asked";
  return restarts < MOST_RESTARTS ? "restart" : "refused";
}

/**
 * Said of a source that would not start at all, so it has to be true of every one of them. Names
 * autoplay as a possibility rather than a finding: the page cannot tell a browser-wide autoplay
 * block from one embed refusing, and the mistake to avoid is asserting the cause you never checked.
 */
export const REFUSED_START =
  "Nothing started playing here — autoplay may be blocked in this browser.";
