/**
 * Whether the volume control can reach the source that is playing, and what to say when it cannot.
 *
 * Every player in this app is somebody else's, and three of them take no level from us. Spotify's
 * `EmbedController` exposes neither `setVolume` nor a mute — the interface in
 * `spotify-player.tsx` is the whole of it — and the Apple Music and Deezer embeds are bare
 * iframes with no API at all (`subscription-player.tsx` passes `useTransport(null)` for the same
 * reason). The bar rendered `<Volume />` for all of them regardless, so on those tracks the
 * slider dragged, the mute button toggled, and neither did anything: the UI stating something
 * untrue, which is the one defect class this repo treats as the serious one.
 *
 * Disabled with a reason rather than hidden. A control that vanishes and comes back as the queue
 * moves between sources is its own kind of lie — it reads as the app losing a feature — and it
 * moves everything beside it. Disabled says "not here, and here is why", and the reason is the
 * part that stops the next reader hunting for a `setVolume` call that was never possible.
 *
 * Spotify is the one that turns on something outside the track: connected, the Web Playback SDK
 * plays it and `spotify-sdk-player.tsx` does call `setVolume`, so the control works and must not
 * be greyed out. Signed out — which is the app's whole premise — it is always the embed. The
 * residue is a connected account whose SDK then failed onto the embed mid-session: the control
 * is enabled there and still does nothing. That errs towards leaving a working control alone,
 * which is the right direction to be wrong in.
 */
export function volumeOutOfReach(kind: string | null, spotifyConnected: boolean): string | null {
  if (kind === "subscription") {
    return "This one plays in Apple Music's or Deezer's own player, which takes its volume from itself.";
  }
  if (kind === "spotify" && !spotifyConnected) {
    return "Spotify's embedded player has no volume control to offer, so this one can't move it.";
  }
  return null;
}
