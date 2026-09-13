import type { SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const TRACKS_PER_SHOW = 6;

interface ArchiveDoc {
  identifier?: string;
  creator?: string | string[];
  title?: string;
}

interface ArchiveFile {
  name?: string;
  format?: string;
  title?: string;
  length?: string;
}

function durationMs(length = ""): number | null {
  const seconds = length.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

function creatorMatches(doc: ArchiveDoc, wanted: string): boolean {
  const target = wanted.trim().toLowerCase();
  return [doc.creator].flat().some((name) => name?.trim().toLowerCase() === target);
}

const request = createRequester({ id: "archive", label: "the Internet Archive", init: cachePolicy });

export function createArchiveProvider(): SearchProvider {
  return {
    id: "archive",
    playback: "queue",
    searchable: false,

    async search() {
      return [];
    },

    async radio(ctx, seed, limit) {
      const artist = seed.artist;
      if (!artist) return [];

      // `artist` is a query parameter on /api/radio. Stripping the quote alone left the
      // backslash, and a trailing one escapes the closing quote in Lucene — so `x\` ended
      // the phrase early and the rest of the name became query syntax. Drop both.
      const query = `collection:etree AND format:"VBR MP3" AND creator:"${artist.replace(/["\\]/g, "")}"`;
      const found = await request<{ response?: { docs?: ArchiveDoc[] } }>(
        ctx,
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl%5B%5D=identifier&fl%5B%5D=creator&fl%5B%5D=title&fl%5B%5D=year&rows=5&output=json`,
      );
      const show = (found.response?.docs ?? []).find(
        (doc) => doc.identifier && creatorMatches(doc, artist),
      );
      if (!show?.identifier) return [];
      const id = show.identifier;

      const item = await request<{ files?: ArchiveFile[] }>(ctx, `https://archive.org/metadata/${id}`);
      const tracks = (item.files ?? [])
        .filter((file) => file.format === "VBR MP3" && file.name && file.title)
        .slice(0, Math.min(TRACKS_PER_SHOW, limit))
        .map<SourceTrack>((file) => ({
          source: "archive",
          sourceId: `${id}/${file.name}`,
          title: file.title!.trim(),
          artists: [artist],
          album: show.title?.trim() ?? null,
          durationMs: durationMs(file.length),
          isrc: null,
          url: `https://archive.org/details/${id}`,
          artworkUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
          playback: "queue",
        }));

      return tracks.length > 0 ? [{ list: "archive:live", tracks }] : [];
    },
  };
}
