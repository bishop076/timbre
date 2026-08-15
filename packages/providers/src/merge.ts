/**
 * Merging results from several sources into one song per recording. Getting it wrong is
 * worse than not merging: collapsing a live take into the studio version means the user
 * queues one song and hears another. An exact ISRC match is decisive; otherwise
 * `dedupeKey` guarded by duration agreement, which carries most of the weight since most
 * of YouTube Music has no ISRC, and which keeps variant markers so "(Live)" never merges.
 */

import { dedupeKey, durationsMatch } from "@timbre/core";

import { byPlayability, type Song, type SourceTrack } from "./types.ts";

interface Group {
  key: string;
  isrc: string | null;
  tracks: SourceTrack[];
}

function matches(group: Group, track: SourceTrack, key: string): boolean {
  // Decisive both ways: two different ISRCs are different recordings, identical titles or not.
  if (group.isrc && track.isrc) {
    return group.isrc === track.isrc;
  }
  if (group.key !== key) return false;

  // Durations must still agree — that separates a radio edit from an extended mix.
  return group.tracks.every((existing) => durationsMatch(existing.durationMs, track.durationMs));
}

/** First non-null value, preferring earlier (higher-ranked) sources. */
function firstDefined<T>(tracks: SourceTrack[], pick: (track: SourceTrack) => T | null): T | null {
  for (const track of tracks) {
    const value = pick(track);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** Merges tracks from any number of sources into songs. Input order is preserved, so
 * results from the primary source should be passed first. */
export function mergeTracks(tracks: SourceTrack[]): Song[] {
  const groups: Group[] = [];

  for (const track of tracks) {
    const key = dedupeKey(track.title, track.artists);
    const existing = groups.find((group) => matches(group, track, key));

    if (existing) {
      // Never list one source twice; its first result is its most relevant.
      if (!existing.tracks.some((candidate) => candidate.source === track.source)) {
        existing.tracks.push(track);
      }
      existing.isrc ??= track.isrc;
      continue;
    }

    groups.push({ key, isrc: track.isrc, tracks: [track] });
  }

  return groups.map((group) => {
    const sources = [...group.tracks].sort(byPlayability);
    const primary = sources[0]!;

    return {
      // Qualified with the primary source track: two groups can share a dedupe key and still
      // be different recordings, and without this they collide as React keys.
      id: group.isrc ?? `${group.key}#${primary.source}:${primary.sourceId}`,
      // Display metadata comes from the most playable source — the copy the user hears.
      title: primary.title,
      artists: primary.artists,
      album: firstDefined(sources, (track) => track.album),
      durationMs: firstDefined(sources, (track) => track.durationMs),
      isrc: group.isrc,
      artworkUrl: firstDefined(sources, (track) => track.artworkUrl),
      sources,
    } satisfies Song;
  });
}
