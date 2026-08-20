/**
 * A track length as `m:ss`, or `h:mm:ss` once it runs past an hour.
 *
 * Four views had their own copy: three of the short form and one hours-aware.
 * The hours-aware one wins because the short form renders a 63-minute mix as
 * "63:12", and DJ sets and full-album uploads are ordinary on the sources
 * Timbre searches.
 *
 * An em dash for null, not "0:00" — a source that does not report a duration is
 * a different thing from a zero-length track.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * A playhead as `m:ss`, from seconds — what the players report, and what the two transports
 * and the lyrics list all had their own copy of.
 *
 * Never `h:mm:ss`: a running clock that gains a field mid-track shifts the whole row. Floored,
 * so the readout never shows a second the track has not reached, and a guard for the `NaN`
 * both widgets report before their first progress event.
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * A playhead sized to the track it is inside — `m:ss` for a song, `h:mm:ss` for anything an
 * hour or longer, and the same shape for both halves of the readout.
 *
 * {@link formatClock} refuses hours so a running clock cannot gain a field mid-track and
 * shift the row. That reasoning holds for the *position* and not for the *total*, which is
 * fixed — and applying it to both rendered a two-hour Mixcloud set as **`120:33`** while the
 * credits beside it correctly said `2:00:33`.
 *
 * Choosing the shape from the total rather than from the position keeps the original promise:
 * the field count is decided once, when the track loads, so nothing shifts while it plays.
 */
export function formatElapsed(seconds: number, totalSeconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return totalSeconds >= 3600 ? "0:00:00" : "0:00";
  if (totalSeconds < 3600) return formatClock(seconds);

  const total = Math.floor(seconds);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
