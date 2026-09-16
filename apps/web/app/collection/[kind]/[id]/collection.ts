import { cache } from "react";

import { fetchCollection, type CollectionKind } from "@/lib/collection";

const KINDS = new Set<CollectionKind>([
  "genre",
  "playlist",
  "mood",
  "radio",
  "spotify-album",
  "spotify-playlist",
  "ytmusic-playlist",
]);

/**
 * One read per request, shared by `layout.tsx`, `generateMetadata` and the page. A kind this app
 * does not serve is an absence decided here, without asking anybody.
 */
export const loadCollection = cache(async (kind: string, id: string) =>
  KINDS.has(kind as CollectionKind) ? fetchCollection(kind as CollectionKind, id) : null,
);
