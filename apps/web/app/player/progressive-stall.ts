/**
 * The progressive element was the one player with no deadline on it.
 *
 * Every embed arms `blockedTimer`, and YouTube arms `youtube-stall.ts` on top of that, because
 * a source that never speaks leaves the track on "loading" with nothing to report and the
 * ladder never walks. A media element can do exactly that without ever firing `error`: a
 * discovery node that accepts the connection and then sends no body, a proxy that holds the
 * request open, a CDN 200 that never delivers. `nextStreamHost` exists precisely because Audius
 * nodes fall over — but it was only ever reached from the `error` event, so the failure mode
 * the four hosts are there for was the one failure mode that could not use them.
 *
 * The measurement mirrors `stalledAt`: it is a stall only if we asked for playback and nothing
 * whatsoever came back.
 *
 * - `paused` is the autoplay guard. A `play()` the browser refused rejects with
 *   `NotAllowedError` and leaves the element paused; that is already reported as a pause and
 *   must not be reported again as a dead stream.
 * - `readyState` below `HAVE_CURRENT_DATA` means not one frame of audio is decodable. Any body
 *   data at all lifts it past this, so a merely slow stream that is arriving is never a stall.
 * - `currentTime` past zero means it did start, whatever it is doing now.
 */
const HAVE_CURRENT_DATA = 2;

/** Long enough for a slow first byte, short enough to still have a fallback host worth trying. */
export const START_DEADLINE_MS = 10_000;

export function stalledStart(media: {
  paused: boolean;
  readyState: number;
  currentTime: number;
}): boolean {
  return !media.paused && media.readyState < HAVE_CURRENT_DATA && media.currentTime <= 0;
}

/**
 * Whether a `play` report from the element means audio is actually coming out.
 *
 * The element fires `play` the instant `play()` is called, before a byte of the body has
 * arrived — so a stream that never loads at all was reported as *playing*: the bar showed Pause
 * and an equaliser over silence, the song was written into the listening history and the play
 * log, and the fresh skip allowance that a playing track earns went to one that never played,
 * which is what bounds a queue of rotted streams. `playing` is the event that means audio, and
 * it is what the component reports on now. This covers the one case that would otherwise feel
 * slower for it: resuming a track the element already has, where `play` arrives first and there
 * is nothing to wait for.
 */
export function startedPlaying(media: { paused: boolean; readyState: number }): boolean {
  return !media.paused && media.readyState >= HAVE_CURRENT_DATA;
}
