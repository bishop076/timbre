import { dedupeParts, durationsMatch, normalizeArtists, normalizeIsrc, normalizeLoose } from "@timbre/core";

import { PLAYBACK_RANK, type Song, type SourceTrack } from "./types.ts";

type Parts = ReturnType<typeof dedupeParts>;

interface Group {
  parts: Parts;
  isrc: string | null;
  tracks: SourceTrack[];
}

/**
 * How far two catalogues may disagree about one recording before it is filed as two.
 *
 * Three seconds is what a catalogue's own rounding costs: Deezer reports whole seconds, Apple
 * reports milliseconds, and the two are measuring masters cut at different times. Measured over
 * 4,906 tracks from the two of them, the disagreement about the *same* studio take runs to 5.6
 * seconds — `The Boxer` 5.1s apart, `Eclipse` 5.7s, every track on `Blonde on Blonde` 3.0–3.9s —
 * so three seconds split songs that nothing else about them distinguished.
 *
 * Simply raising the number is the wrong answer, because the gap between two genuinely different
 * cuts of one song — a single edit, a music video with an intro — starts in the same range. The
 * wider window is therefore only opened when something *other than* the title says the two are
 * the same release: see `corroborated`. Seven seconds covers the disagreement measured with room
 * to spare, and the nearest thing over the same 4,906 tracks that the corroboration can reach
 * and that really is two recordings sits 57 seconds out: `In the Flesh?` and `In the Flesh`, one
 * name on one side of `The Wall`.
 */
const CORROBORATED_TOLERANCE_MS = 7_000;

function creditsAgree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return a.length === b.length;
  return a.every((name) => b.includes(name)) || b.every((name) => a.includes(name));
}

function sameAlbum(a: SourceTrack, b: SourceTrack): boolean {
  if (!a.album || !b.album) return false;
  const album = normalizeLoose(a.album);
  return album.length > 0 && album === normalizeLoose(b.album);
}

function sameCredits(a: SourceTrack, b: SourceTrack): boolean {
  const [left, right] = [normalizeArtists(a.artists), normalizeArtists(b.artists)];
  return left.length > 0 && left.length === right.length && left.every((name, at) => name === right[at]);
}

/**
 * Evidence, from outside the part of the title the grouping already compared, that two tracks
 * are one release.
 *
 * By this point the two agree on the normalised base, on the version tags and on the credits —
 * but that base is what is left *after* noise comes off, so `Changes` and `Changes (2015
 * Remaster)` arrive here looking identical, and so do two different remixes off one EP. A second
 * witness the first comparison could not have produced is either an identical title, down to the
 * punctuation, or the same album. Where the titles are not identical the album is required and
 * the difference has to be one of them saying more than the other — `Changes (2015 Remaster)`
 * extends `Changes`, `Boehm Remix` and `DJ Kue Remix` contradict each other.
 *
 * The cut that should stay separate is still safe at this distance: a radio edit runs a minute
 * or more short of the album version, and a video with an intro tens of seconds long — and where
 * an uploader titles a video in their own words and gives it no album, no witness appears at all
 * and the three-second guard stands.
 */
function corroborated(a: SourceTrack, b: SourceTrack): boolean {
  const [left, right] = [normalizeLoose(a.title), normalizeLoose(b.title)];
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return sameCredits(a, b) || sameAlbum(a, b);
  return sameAlbum(a, b) && (left.startsWith(`${right} `) || right.startsWith(`${left} `));
}

function sameRecording(a: SourceTrack, b: SourceTrack): boolean {
  if (durationsMatch(a.durationMs, b.durationMs)) return true;
  if (!durationsMatch(a.durationMs, b.durationMs, CORROBORATED_TOLERANCE_MS)) return false;
  return corroborated(a, b);
}

function matches(group: Group, track: SourceTrack, parts: Parts, isrc: string | null): boolean {
  // Two tracks that each carry an ISRC, and carry different ones, are different recordings —
  // the title fallback below must not overrule that. It is only sound because the ISRCs being
  // compared are canonical: see `normalizeIsrc`.
  if (group.isrc && isrc) return group.isrc === isrc;
  // Nothing to compare is not a match. A title made only of punctuation used to arrive here as
  // an empty base, which matched every other one, so two unrelated songs by one artist came out
  // as one row whose lead source played the other song; `parseTitle` now keeps the marks, and
  // what is left here is a track that carries no title at all.
  if (!parts.base && parts.variants.length === 0) return false;
  return (
    group.parts.base === parts.base &&
    group.parts.variants.join("+") === parts.variants.join("+") &&
    creditsAgree(group.parts.artists, parts.artists) &&
    group.tracks.every((existing) => sameRecording(existing, track))
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
