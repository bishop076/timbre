/**
 * Whether a YouTube upload has stalled: loaded, told to play, and getting nowhere.
 *
 * Lives apart from the player so it can be tested — it is the one judgement behind the
 * stall timer in `youtube-player.tsx`, and a wrong answer either abandons a song that was
 * about to play or leaves a spinner up for ever.
 */

/** `YT.PlayerState` values. Only the two that mean "trying" can be a stall. */
const UNSTARTED = -1;
const BUFFERING = 3;

/**
 * True when the player is still trying and has nothing to show for it.
 *
 * Both measurements have to be zero. A slow connection buffers *something* within the
 * timer's window, so a positive fraction means wait; a position past zero means it played,
 * even if the reader has since paused. PLAYING, PAUSED, CUED and ENDED are all settled
 * states and never stalls, whatever the numbers say.
 */
export function stalledAt(state: number, loadedFraction: number, position: number): boolean {
  if (state !== UNSTARTED && state !== BUFFERING) return false;
  return loadedFraction <= 0 && position <= 0;
}
