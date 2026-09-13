import { dedupeParts, durationsMatch, normalizeIsrc } from "@timbre/core";

import { PLAYBACK_RANK, type Song, type SourceTrack } from "./types.ts";

type Parts = ReturnType<typeof dedupeParts>;

interface Group {
  parts: Parts;
  isrc: string | null;
  tracks: SourceTrack[];
}

function creditsAgree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return a.length === b.length;
  return a.every((name) => b.includes(name)) || b.every((name) => a.includes(name));
}

function matches(group: Group, track: SourceTrack, parts: Parts, isrc: string | null): boolean {
  // Two tracks that each carry an ISRC, and carry different ones, are different recordings —
  // the title fallback below must not overrule that. It is only sound because the ISRCs being
  // compared are canonical: see `normalizeIsrc`.
  if (group.isrc && isrc) return group.isrc === isrc;
  return (
    group.parts.base === parts.base &&
    group.parts.variants.join("+") === parts.variants.join("+") &&
    creditsAgree(group.parts.artists, parts.artists) &&
    group.tracks.every((existing) => durationsMatch(existing.durationMs, track.durationMs))
  );
}

function firstDefined<T>(tracks: SourceTrack[], pick: (track: SourceTrack) => T | null): T | null {
  return tracks.map(pick).find((value) => value !== null && value !== undefined) ?? null;
}

export function mergeTracks(tracks: SourceTrack[]): Song[] {
  const groups: Group[] = [];

  for (const track of tracks) {
    const parts = dedupeParts(track.title, track.artists);
    const isrc = normalizeIsrc(track.isrc);
    const existing =
      (isrc ? groups.find((group) => group.isrc === isrc) : undefined) ??
      groups.find((group) => matches(group, track, parts, isrc));

    if (!existing) {
      groups.push({ parts, isrc, tracks: [track] });
      continue;
    }
    if (!existing.tracks.some((candidate) => candidate.source === track.source)) {
      existing.tracks.push(track);
    }
    existing.isrc ??= isrc;
  }

  return groups.map(({ parts, isrc, tracks: grouped }) => {
    const sources = grouped.sort((a, b) => PLAYBACK_RANK[a.playback] - PLAYBACK_RANK[b.playback]);
    const primary = sources[0]!;
    const key = [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");

    return {
      id: isrc || `${key}#${primary.source}:${primary.sourceId}`,
      title: primary.title,
      artists: primary.artists,
      album: firstDefined(sources, (track) => track.album),
      durationMs: firstDefined(sources, (track) => track.durationMs),
      isrc,
      artworkUrl: firstDefined(sources, (track) => track.artworkUrl),
      artworkFallbacks: sources.find((track) => track.artworkUrl)?.artworkFallbacks,
      sources,
    } satisfies Song;
  });
}
