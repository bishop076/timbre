/**
 * Merging results from several sources into one song per recording.
 *
 * This is the product. "Search once, see every service that has it" is
 * entirely a matching problem, and getting it wrong is worse than not merging
 * at all: collapsing a live take into the studio version means the user queues
 * one song and hears another.
 *
 * Two rules, in order of confidence:
 *
 *   1. **ISRC** identifies a recording globally. An exact match is decisive.
 *   2. **dedupeKey + duration** otherwise — normalized title, variant tags and
 *      artist set from @timbre/core, guarded by duration agreement. Most of
 *      YouTube Music has no ISRC, so this rule carries most of the weight.
 *
 * `dedupeKey` deliberately keeps variant markers, so "(Live)" and "- Remix"
 * never merge into the original.
 */

import { dedupeKey, durationsMatch } from "@timbre/core";

import { byPlayability, type Song, type SourceTrack } from "./types.ts";

interface Group {
  key: string;
  isrc: string | null;
  tracks: SourceTrack[];
}

function matches(group: Group, track: SourceTrack, key: string): boolean {
  // ISRC is decisive in both directions: equal means the same recording,
  // and two different ISRCs mean genuinely different recordings even when the
  // titles look identical.
  if (group.isrc && track.isrc) {
    return group.isrc === track.isrc;
  }
  if (group.key !== key) return false;

  // Same normalized identity, but durations must still agree — this is what
  // separates a radio edit from an extended mix when neither is labelled.
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

/**
 * Merges tracks from any number of sources into songs.
 *
 * Input order matters and is preserved: results from the primary source should
 * be passed first, so the merged output keeps that relevance ordering.
 */
export function mergeTracks(tracks: SourceTrack[]): Song[] {
  const groups: Group[] = [];

  for (const track of tracks) {
    const key = dedupeKey(track.title, track.artists);
    const existing = groups.find((group) => matches(group, track, key));

    if (existing) {
      // Never list the same source twice for one song; the first result from a
      // given service is its most relevant one.
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
      // Two groups can legitimately share a dedupe key and still be different
      // recordings — separated by duration rather than by title. So the id is
      // qualified with the primary source track, which is unique by
      // construction. Without this, distinct songs collide as React keys and
      // in any id-based lookup.
      id: group.isrc ?? `${group.key}#${primary.source}:${primary.sourceId}`,
      // Display metadata comes from the most playable source, since that is
      // the copy the user will actually hear.
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
