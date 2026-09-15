/**
 * Whether a SoundCloud track that was told to play ever actually started.
 *
 * SoundCloud is asked this question rather than told it: the widget lives in a cross-origin
 * iframe and every reading comes back over `postMessage`. That is the trap this exists for. The
 * guard in `soundcloud-player.tsx` used to answer it with `widget.getPosition` and
 * `widget.isPaused` alone, so when the widget stopped answering at all — which is exactly what
 * a widget that has died does — the callbacks never ran and the guard never fired. A track in
 * the middle of a playlist sat at 0:00 reading "playing" for as long as the tab was left open,
 * and every song after it never played. Silence has to be an answer here, or the only failure
 * this can catch is the one where the widget is well enough to describe its own illness.
 *
 * The reprieve is the other half. `PLAY_PROGRESS` clears the deadline several times a second
 * while a track runs, so reaching this point at all means nothing has played for the whole
 * window — but a widget that says it is not paused may still be buffering a slow stream, and
 * cutting that off would move a listener to another source for a track that was about to play.
 * It gets one more window to prove it, and no more.
 */
export interface StartReading {
  /** Milliseconds into the track, as the widget reports it. */
  position: number;
  /** What the widget says about itself — not always the truth, which is the point. */
  paused: boolean;
}

export type StartVerdict = "playing" | "wait" | "stalled";

export const MOST_REPRIEVES = 1;

/**
 * `reading` is `null` when the widget did not answer inside the deadline.
 *
 * `reprieves` is how many extra windows this track has already been given.
 */
export function judgeSoundCloudStart(
  reading: StartReading | null,
  reprieves: number,
): StartVerdict {
  if (reading === null) return "stalled";
  if (reading.position > 0) return "playing";
  if (!reading.paused && reprieves < MOST_REPRIEVES) return "wait";
  return "stalled";
}
