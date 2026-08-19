/**
 * Where the audio is, for the sources Timbre plays itself.
 *
 * Every other source hands back a player to embed; these two hand back bytes, so the app
 * points an `<audio>` element at them. The shapes are mirrored from
 * `packages/providers/src/{audius,archive}.ts` rather than imported, for the reason
 * `app/types.ts` gives: a client component must not pull in a server-only package.
 */

/** Sources that stream progressive audio rather than embedding a player. */
export const PROGRESSIVE_SOURCES = ["audius", "archive"] as const;

export type ProgressiveSource = (typeof PROGRESSIVE_SOURCES)[number];

export function isProgressive(source: string | null): source is ProgressiveSource {
  return source !== null && (PROGRESSIVE_SOURCES as readonly string[]).includes(source);
}

/**
 * `skip_play_count=false` on Audius is not decoration: without it the redirect arrives
 * carrying `true` and the listen is never credited to the artist. The archive needs no such
 * argument — its `sourceId` is already `{identifier}/{filename}`, which is the whole handle
 * a download URL takes.
 */
export function streamUrlFor(source: ProgressiveSource, sourceId: string): string {
  switch (source) {
    case "audius":
      return `https://api.audius.co/v1/tracks/${encodeURIComponent(sourceId)}/stream?skip_play_count=false`;
    case "archive":
      return `https://archive.org/download/${sourceId.split("/").map(encodeURIComponent).join("/")}`;
  }
}
