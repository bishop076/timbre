/**
 * What to do about a track the ladder could not play.
 *
 * Every source in `player-context.tsx` eventually gives up the same way — `writeState(
 * "unplayable")` and a message — and until this existed that was the end of the queue too. One
 * rotted source in the middle of a saved playlist (a stream id that 404s a year after the song
 * was saved) stopped everything after it, with the next song named on screen under "NEXT UP"
 * the whole time. Nothing here is about *why* a track failed; that ladder has already run. This
 * only answers whether the queue should carry on without it.
 */
export interface DeadTrack {
  /**
   * A listener singled this source out — "Play from SoundCloud" on one song, rather than the
   * queue reaching it. They asked for that exact thing, so they get to see it fail; stepping
   * over it would look like the press did nothing.
   */
  chosenByHand: boolean;
  /** How many tracks in a row have already been stepped over without one playing. */
  skipped: number;
  /** How many tracks the queue holds. */
  queued: number;
}

/**
 * A ceiling on top of "one pass of the queue", for the case radio keeps feeding a queue whose
 * every pick is dead. Each skip costs a resolve and a search, so a long unplayable run should
 * stop and say so rather than grind through hundreds of them.
 */
export const MOST_SKIPS = 25;

/**
 * `stop` leaves the player where it is, showing what went wrong. `skip` moves to the next track.
 *
 * The allowance is one pass of the queue, counted from the last track that actually played —
 * `skipped` is reset by playback starting, not by a track being reached. That is what keeps
 * `repeat: "all"` over an entirely dead queue from looping for the life of the tab: every
 * position gets exactly one attempt, and then the player stops with a message.
 */
export function judgeDeadTrack({ chosenByHand, skipped, queued }: DeadTrack): "skip" | "stop" {
  if (chosenByHand) return "stop";
  // Nowhere to go. `repeat: "all"` over a single dead track would otherwise reload it forever.
  if (queued < 2) return "stop";
  if (skipped >= Math.min(queued, MOST_SKIPS)) return "stop";
  return "skip";
}
