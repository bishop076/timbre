// Queue edits, as pure functions, outside the player context so the arithmetic is testable.
// The subtle part is `index`, not the splicing: playback is tracked by *position*, not
// identity, so every edit that reorders the list around it has to move it in step, or the
// row highlighted as playing drifts away from what is audible.

import type { Song } from "../types";

/** The result of an edit, or `null` when the edit was a no-op. */
export interface QueueEdit {
  queue: Song[];
  index: number;
  /** Set only when the edit moved playback onto a *different* song. Null means carry
   * on — the common case, and the one that must not restart the track. */
  play: Song | null;
  /** True when the queue is now empty and the players should be torn down. */
  stopped: boolean;
}

/** Removes one entry. Removing the *playing* song hands its slot to whichever song slid
 * into it, so this skips rather than leaving `index` pointing outside the list. */
export function removeAt(queue: Song[], index: number, position: number): QueueEdit | null {
  const song = queue[position];
  if (!song) return null;

  const remaining = queue.filter((_, at) => at !== position);

  // Ahead of the playhead the current song keeps its position; behind it, everything
  // after shifts down by one, including the playhead.
  if (position > index) return { queue: remaining, index, play: null, stopped: false };

  if (position < index) return { queue: remaining, index: index - 1, play: null, stopped: false };

  if (remaining.length === 0) return { queue: remaining, index: 0, play: null, stopped: true };

  // Removing the last entry leaves nothing at `position`: fall back, not off the end.
  const at = Math.min(position, remaining.length - 1);
  return { queue: remaining, index: at, play: remaining[at]!, stopped: false };
}

/**
 * Puts songs immediately after the playing one — "play next", as against `enqueue`'s
 * "eventually". The playhead does not move: the song playing keeps both its position and
 * its audio, and the additions land in the gap behind it.
 *
 * Callers deduplicate first. This one only splices.
 */
export function insertAfter(queue: Song[], index: number, songs: Song[]): QueueEdit | null {
  if (songs.length === 0) return null;

  // Nothing is playing, so there is no "after this one". The additions become the queue and
  // the first has to start, exactly as adding to an empty queue does — otherwise the songs
  // arrive and sit there silently.
  if (queue.length === 0) return { queue: songs, index: 0, play: songs[0]!, stopped: false };

  // Clamped, because an index past the end would splice at the wrong place rather than throw.
  const at = Math.min(Math.max(index, 0), queue.length - 1) + 1;

  return {
    queue: [...queue.slice(0, at), ...songs, ...queue.slice(at)],
    index,
    play: null,
    stopped: false,
  };
}

/** Moves an entry. `to` is interpreted against the list *with the moved song taken out*,
 * which is what makes "move down by one" a single step rather than a no-op. */
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
