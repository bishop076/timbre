// The Internet Archive's Live Music Archive — `collection:etree`, a quarter-million concert
// recordings uploaded with the performing band's permission. **The cleanest licensing of any
// source Timbre touches**, keyless, and it streams `206 audio/mpeg` with ranges and
// `Access-Control-Allow-Origin: *`.
//
// **It is deliberately not searchable, and that is the whole design.** Measured 2026-08-19,
// a plain query is confidently wrong for the music Timbre's readers look for: *Fred again..*
// returned 220 items led by a 1973 Grateful Dead show, *Aphex Twin* returned Tim Reynolds,
// *Sade* matched a substring. Put that in `searchAll` and every search grows a tail of
// unrelated concert tapes.
//
// Scoped to an exact `creator`, it abstains instead — 0 for *Fred again..*, *Wonderwall*,
// *Aphex Twin* and *Sade*, 18,337 for *Grateful Dead*. A source that answers nothing rather
// than answering wrongly is one this project can use, so the archive contributes exactly one
// ranked list and only when the artist playing is a taper-friendly act.

import type { RadioSeed, RankedList, SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const SEARCH = "https://archive.org/advancedsearch.php";
const METADATA = "https://archive.org/metadata";
const DOWNLOAD = "https://archive.org/download";
/** The item tile. One stable host, unlike the per-item content nodes the audio comes from,
 * which is what lets it go through Timbre's artwork proxy at all. */
const IMAGE = "https://archive.org/services/img";

/** How many shows to consider. One is usually enough and each costs a second round trip. */
const SHOWS = 1;
/** Tracks taken from a show. A whole set would swamp every other list in the fusion. */
const TRACKS_PER_SHOW = 6;

interface ArchiveDoc {
  identifier?: string;
  creator?: string | string[];
  title?: string;
  year?: string;
}

interface ArchiveFile {
  name?: string;
  format?: string;
  title?: string;
  track?: string;
  /** `mm:ss`, `h:mm:ss`, or occasionally raw seconds. */
  length?: string;
}

/** `06:04` and `1:02:33` and `364.5` all appear in the same field. */
function durationMs(length: string | undefined): number | null {
  if (!length) return null;
  const parts = length.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? Math.round(seconds * 1000) : null;
}

/** Creator arrives as a string or a list, and often decorated — "Music By Umphrey's McGee,
 * Capture by …". Only a clean case-insensitive equality passes, for the same reason Deezer's
 * artist lookup insists on one: a tribute act is a different band. */
// Worth not rediscovering: this guard is what keeps tribute acts out. Every one of the 142
// `creator:"Phish"` hits is a different band — *Jazz Is Phish*, *Chum, A Tribute to Phish*,
// *Dead Phish Orchestra* — because Phish itself is not on the archive. Loosen this to a
// substring and the radio starts recommending covers as though they were the artist.
function creatorMatches(doc: ArchiveDoc, wanted: string): boolean {
  const target = wanted.trim().toLowerCase();
  const names = Array.isArray(doc.creator) ? doc.creator : [doc.creator];
  return names.some((name) => name?.trim().toLowerCase() === target);
}

const request = createRequester({
  id: "archive",
  label: "the Internet Archive",
  init: cachePolicy,
});

export function createArchiveProvider(): SearchProvider {
  return {
    id: "archive",
    playback: "queue",
    // Never in `searchAll`. See the header — a plain query here is worse than no source.
    searchable: false,

    // Required by the interface, and unreachable while `searchable` is false.
    async search() {
      return [];
    },

    /**
     * Live takes of whatever is playing, when the archive has the band at all. One list, a
     * handful of tracks, and silence for almost every artist — which is the correct outcome
     * rather than a shortfall.
     */
    async radio(ctx: SearchContext, seed: RadioSeed, limit: number): Promise<RankedList[]> {
      if (!seed.artist) return [];

      // `format:"VBR MP3"` is load-bearing, not tidiness. Plenty of shows are uploaded as
      // FLAC or SHN with no MP3 derivative, and asking the index to exclude them costs
      // nothing — where filtering afterwards costs a wasted metadata round trip per show,
      // and abstaining wrongly when the first candidate happens to be lossless-only.
      const query = `collection:etree AND format:"VBR MP3" AND creator:"${seed.artist.replace(/"/g, "")}"`;
      const found = await request<{ response?: { docs?: ArchiveDoc[] } }>(
        ctx,
        `${SEARCH}?q=${encodeURIComponent(query)}&fl%5B%5D=identifier&fl%5B%5D=creator&fl%5B%5D=title&fl%5B%5D=year&rows=5&output=json`,
      );

      const show = (found?.response?.docs ?? [])
        .filter((doc) => doc.identifier && creatorMatches(doc, seed.artist!))
        .slice(0, SHOWS)[0];
      if (!show?.identifier) return [];

      // Second hop, and the reason this is a radio contribution rather than a search: the
      // index holds *shows*, and only an item's own metadata lists the songs inside it.
      const item = await request<{ files?: ArchiveFile[] }>(ctx, `${METADATA}/${show.identifier}`);

      const tracks = (item?.files ?? [])
        .filter((file) => file.format === "VBR MP3" && file.name && file.title)
        .slice(0, Math.min(TRACKS_PER_SHOW, limit))
        .map<SourceTrack>((file) => ({
          source: "archive",
          // Identifier and filename together: the download path is the only handle a
          // progressive stream needs, and there is no per-track id in this archive.
          sourceId: `${show.identifier}/${file.name}`,
          title: file.title!.trim(),
          artists: [seed.artist!],
          album: show.title?.trim() ?? null,
          durationMs: durationMs(file.length),
          isrc: null,
          url: `https://archive.org/details/${show.identifier}`,
          // Per item rather than per track — a show has one tile and the tracks inside it
          // have none, which is truer to what a concert recording is than inventing one.
          artworkUrl: `${IMAGE}/${encodeURIComponent(show.identifier!)}`,
          playback: "queue",
        }));

      // An empty list would tell the ranker the archive answered. It did not.
      return tracks.length > 0 ? [{ list: "archive:live", tracks }] : [];
    },
  };
}

/** Where the audio actually lives. Mirrored in `app/player/stream-url.ts`, which cannot
 * import this package — see `app/types.ts` on why a client component must not. */
export function archiveStreamUrl(sourceId: string): string {
  return `${DOWNLOAD}/${sourceId.split("/").map(encodeURIComponent).join("/")}`;
}
