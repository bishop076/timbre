/**
 * Queue edits, as pure functions.
 *
 * These live outside the player context for the same reason the token bucket in
 * @timbre/core does: the arithmetic is where the bugs are, and it is only
 * testable once it is separated from the thing holding the state.
 *
 * The subtle part is not the array splicing — it is `index`. Playback is
 * tracked by *position*, not by identity, so every edit that reorders the list
 * around it has to move it in step. Get that wrong and the row highlighted as
 * playing drifts away from the song actually coming out of the speakers, which
 * is the kind of bug that looks like a rendering glitch and is not.
 */

import type { Song } from "../types";

/** The result of an edit, or `null` when the edit was a no-op. */
export interface QueueEdit {
  queue: Song[];
  index: number;
  /**
   * Set only when the edit moved playback onto a *different* song, so the
   * caller knows to load it. Null means carry on playing what is playing —
   * which is the common case, and the one that must not restart the track.
   */
  play: Song | null;
  /** True when the queue is now empty and the players should be torn down. */
  stopped: boolean;
}

/**
 * Removes one entry.
 *
 * Removing the *playing* song hands its slot to whichever song slid into it —
 * the one the queue would have played next anyway — so this behaves like a skip
 * that also forgets the track, and never leaves `index` pointing at a song that
 * is no longer in the list.
 */
export function removeAt(queue: Song[], index: number, position: number): QueueEdit | null {
  const song = queue[position];
  if (!song) return null;

  const remaining = queue.filter((_, at) => at !== position);

  // Ahead of the playhead: the current song keeps its position.
  if (position > index) return { queue: remaining, index, play: null, stopped: false };

  // Behind it: everything after shifts down by one, including the playhead.
  if (position < index) return { queue: remaining, index: index - 1, play: null, stopped: false };

  if (remaining.length === 0) return { queue: remaining, index: 0, play: null, stopped: true };

  // Removing the last entry leaves nothing at `position`, so fall back onto the
  // new final song rather than off the end of the list.
  const at = Math.min(position, remaining.length - 1);
  return { queue: remaining, index: at, play: remaining[at]!, stopped: false };
}

/**
 * Moves an entry to another position.
 *
 * `to` is interpreted against the list *with the moved song taken out*, which
 * is what makes "move down by one" a single step rather than a no-op.
 */
export function moveWithin(queue: Song[], index: number, from: number, to: number): QueueEdit | null {
  const song = queue[from];
  if (!song || from === to || to < 0 || to >= queue.length) return null;

  const rest = queue.filter((_, at) => at !== from);
  const reordered = [...rest.slice(0, to), song, ...rest.slice(to)];

  let next = index;
  if (from === index) next = to;
  else if (from < index && to >= index) next = index - 1;
  else if (from > index && to <= index) next = index + 1;

  return { queue: reordered, index: next, play: null, stopped: false };
}
