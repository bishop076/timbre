/**
 * Merging results from several sources into one song per recording. Getting it wrong is
 * worse than not merging: collapsing a live take into the studio version means the user
 * queues one song and hears another. An exact ISRC match is decisive; otherwise
 * the dedupe parts guarded by duration agreement, which carries most of the weight since most
 * of YouTube Music has no ISRC, and which keeps variant markers so "(Live)" never merges.
 */

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

/**
 * Whether two credit lists describe the same billing.
 *
 * **Equal, or one contained in the other.** Catalogues disagree about guests constantly:
 * Deezer billed "This Was Your Song" to Lé Real while Apple billed the same recording to
 * "Lé Real & Jordan Maxwell", so the two never shared a key and the song listed twice.
 * Containment rather than a shared primary artist, because `normalizeArtists` sorts and
 * leaves no primary to compare — and containment is the stricter of the two anyway.
 *
 * Two empty lists agree; one empty against one credited does not, or a track naming nobody
 * would swallow every other recording that shares its title.
 */
function creditsAgree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return a.length === b.length;
  return a.every((name) => b.includes(name)) || b.every((name) => a.includes(name));
}

function matches(group: Group, track: SourceTrack, parts: Parts): boolean {
  // Decisive both ways: two different ISRCs are different recordings, identical titles or not.
  if (group.isrc && track.isrc) {
    return group.isrc === track.isrc;
  }

  if (group.parts.base !== parts.base) return false;
  // Variants are the whole point of keeping them: "(Live)" must never merge into the studio
  // take, however well the credits and the length agree.
  if (group.parts.variants.join("+") !== parts.variants.join("+")) return false;
  if (!creditsAgree(group.parts.artists, parts.artists)) return false;

  // Durations must still agree — that separates a radio edit from an extended mix, and it is
  // what stops the relaxed credit test collapsing two different recordings.
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
    const parts = dedupeParts(track.title, track.artists);
    const key = [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");
    // An ISRC names the recording outright, so a group already holding it is *the* group —
    // found before any title match. Otherwise a track whose ISRC belonged to the second group
    // was filed into the first on its title, and two songs came out sharing one id.
    const existing =
      (track.isrc ? groups.find((group) => group.isrc === track.isrc) : undefined) ??
      groups.find((group) => matches(group, track, parts));

    if (existing) {
      // Never list one source twice; its first result is its most relevant.
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
      // Qualified with the primary source track: two groups can share a dedupe key and still
      // be different recordings, and without this they collide as React keys.
      // `||` rather than `??`: a provider that sends `""` instead of omitting the field would
      // otherwise pass an empty id straight through, and every such song would share it —
      // which is the same collision this line exists to prevent. Audius did exactly that.
      id: group.isrc || `${group.key}#${primary.source}:${primary.sourceId}`,
      // Display metadata comes from the most playable source — the copy the user hears.
      title: primary.title,
      artists: primary.artists,
      album: firstDefined(sources, (track) => track.album),
      durationMs: firstDefined(sources, (track) => track.durationMs),
      isrc: group.isrc,
      artworkUrl: firstDefined(sources, (track) => track.artworkUrl),
      // From the same source as the cover, never a different one: these are mirrors of *that*
      // image, and pairing them with another source's URL would point at bytes that are not
      // there.
      artworkFallbacks: sources.find((track) => track.artworkUrl)?.artworkFallbacks,
      sources,
    } satisfies Song;
  });
}
