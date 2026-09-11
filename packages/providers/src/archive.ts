import type { RadioSeed, RankedList, SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const SEARCH = "https://archive.org/advancedsearch.php";
const METADATA = "https://archive.org/metadata";
const DOWNLOAD = "https://archive.org/download";
const IMAGE = "https://archive.org/services/img";

const SHOWS = 1;
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
  length?: string;
}

function durationMs(length: string | undefined): number | null {
  if (!length) return null;
  const parts = length.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? Math.round(seconds * 1000) : null;
}

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
    searchable: false,

    async search() {
      return [];
    },

    async radio(ctx: SearchContext, seed: RadioSeed, limit: number): Promise<RankedList[]> {
      if (!seed.artist) return [];

      const query = `collection:etree AND format:"VBR MP3" AND creator:"${seed.artist.replace(/"/g, "")}"`;
      const found = await request<{ response?: { docs?: ArchiveDoc[] } }>(
        ctx,
        `${SEARCH}?q=${encodeURIComponent(query)}&fl%5B%5D=identifier&fl%5B%5D=creator&fl%5B%5D=title&fl%5B%5D=year&rows=5&output=json`,
      );

      const show = (found?.response?.docs ?? [])
        .filter((doc) => doc.identifier && creatorMatches(doc, seed.artist!))
        .slice(0, SHOWS)[0];
      if (!show?.identifier) return [];

      const item = await request<{ files?: ArchiveFile[] }>(ctx, `${METADATA}/${show.identifier}`);

      const tracks = (item?.files ?? [])
        .filter((file) => file.format === "VBR MP3" && file.name && file.title)
        .slice(0, Math.min(TRACKS_PER_SHOW, limit))
        .map<SourceTrack>((file) => ({
          source: "archive",
          sourceId: `${show.identifier}/${file.name}`,
          title: file.title!.trim(),
          artists: [seed.artist!],
          album: show.title?.trim() ?? null,
          durationMs: durationMs(file.length),
          isrc: null,
          url: `https://archive.org/details/${show.identifier}`,
          artworkUrl: `${IMAGE}/${encodeURIComponent(show.identifier!)}`,
          playback: "queue",
        }));

      return tracks.length > 0 ? [{ list: "archive:live", tracks }] : [];
    },
  };
}

export function archiveStreamUrl(sourceId: string): string {
  return `${DOWNLOAD}/${sourceId.split("/").map(encodeURIComponent).join("/")}`;
}
