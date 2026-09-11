import { dedupeParts, durationsMatch } from "@timbre/core";

import { byPlayability, type Song, type SourceTrack } from "./types.ts";

interface Parts {
  base: string;
  variants: string[];
  artists: string[];
}

interface Group {
  key: string;
  parts: Parts;
  isrc: string | null;
  tracks: SourceTrack[];
}

function creditsAgree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return a.length === b.length;
  return a.every((name) => b.includes(name)) || b.every((name) => a.includes(name));
}

function matches(group: Group, track: SourceTrack, parts: Parts): boolean {
  if (group.isrc && track.isrc) {
    return group.isrc === track.isrc;
  }

  if (group.parts.base !== parts.base) return false;
  if (group.parts.variants.join("+") !== parts.variants.join("+")) return false;
  if (!creditsAgree(group.parts.artists, parts.artists)) return false;

  return group.tracks.every((existing) => durationsMatch(existing.durationMs, track.durationMs));
}

function firstDefined<T>(tracks: SourceTrack[], pick: (track: SourceTrack) => T | null): T | null {
  for (const track of tracks) {
    const value = pick(track);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export function mergeTracks(tracks: SourceTrack[]): Song[] {
  const groups: Group[] = [];

  for (const track of tracks) {
    const parts = dedupeParts(track.title, track.artists);
    const key = [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");
    const existing =
      (track.isrc ? groups.find((group) => group.isrc === track.isrc) : undefined) ??
      groups.find((group) => matches(group, track, parts));

    if (existing) {
      if (!existing.tracks.some((candidate) => candidate.source === track.source)) {
        existing.tracks.push(track);
      }
      existing.isrc ??= track.isrc;
      continue;
    }

    groups.push({ key, parts, isrc: track.isrc, tracks: [track] });
  }

  return groups.map((group) => {
    const sources = [...group.tracks].sort(byPlayability);
    const primary = sources[0]!;

    return {
      id: group.isrc || `${group.key}#${primary.source}:${primary.sourceId}`,
      title: primary.title,
      artists: primary.artists,
      album: firstDefined(sources, (track) => track.album),
      durationMs: firstDefined(sources, (track) => track.durationMs),
      isrc: group.isrc,
      artworkUrl: firstDefined(sources, (track) => track.artworkUrl),
      artworkFallbacks: sources.find((track) => track.artworkUrl)?.artworkFallbacks,
      sources,
    } satisfies Song;
  });
}
