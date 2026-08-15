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
