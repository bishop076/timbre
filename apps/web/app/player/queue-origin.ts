/**
 * The list a queue was started from, and whether a given list is that one.
 *
 * A song carries `from` for its artist, but nothing recorded the list itself, so no page could
 * say "this is the one playing" — which is what turns a detail page's Play button into Pause
 * while its own tracks are running.
 *
 * `kind` matters as much as `id`: a playlist's uuid, an album's catalogue id and a chart's key
 * come from three different namespaces, and nothing stops two of them colliding.
 */
export interface QueueOrigin {
  kind: "playlist" | "album" | "collection";
  id: string;
}

/**
 * A collection is a genre chart, a station, a Spotify album or playlist — a page assembled from
 * somewhere else and kept nowhere. Its `id` is only unique within its kind (`genre` 132 and
 * `radio` 132 are different pages), so the kind goes into the id as well.
 */
export function collectionOrigin(kind: string, id: string): QueueOrigin {
  return { kind: "collection", id: `${kind}:${id}` };
}

/** Whether the queue now playing was started from this exact list. */
export function samePlace(playing: QueueOrigin | null, list: QueueOrigin | undefined): boolean {
  return list !== undefined && playing?.kind === list.kind && playing.id === list.id;
}
