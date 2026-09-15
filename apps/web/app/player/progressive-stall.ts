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
