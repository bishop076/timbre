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
 * The hostnames serving Audius's `/v1` API, in the order they are tried. Mirrored from
 * `AUDIUS_HOSTS` in `packages/providers/src/audius.ts`, which says why these four and why
 * the list is not discovered. All four answered `/stream` with a 302 carrying
 * `skip_play_count=false` through to the content node, measured 2026-09-11.
 */
const AUDIUS_HOSTS = [
  "https://api.audius.co",
  "https://discoveryprovider.audius.co",
  "https://discoveryprovider2.audius.co",
  "https://discoveryprovider3.audius.co",
] as const;

/**
 * `skip_play_count=false` on Audius is not decoration: without it the redirect arrives
 * carrying `true` and the listen is never credited to the artist. The archive needs no such
 * argument — its `sourceId` is already `{identifier}/{filename}`, which is the whole handle
 * a download URL takes.
 */
export function streamUrlFor(source: ProgressiveSource, sourceId: string): string {
  switch (source) {
    case "audius":
      return `${AUDIUS_HOSTS[0]}/v1/tracks/${encodeURIComponent(sourceId)}/stream?skip_play_count=false`;
    case "archive":
      return `https://archive.org/download/${sourceId.split("/").map(encodeURIComponent).join("/")}`;
  }
}

/**
 * The same stream on the next Audius host, or null when there is nowhere else to ask — the
 * last host, or a source with only one.
 *
 * The server's search already walks the hosts, so on a day `api.audius.co` is down it still
 * returns Audius results; without this, every one of them then failed to play from the host
 * the search had just routed around.
 */
export function nextStreamHost(url: string): string | null {
  for (let index = 0; index < AUDIUS_HOSTS.length - 1; index++) {
    const host = AUDIUS_HOSTS[index]!;
    if (url.startsWith(`${host}/`)) return `${AUDIUS_HOSTS[index + 1]}${url.slice(host.length)}`;
  }
  return null;
}
