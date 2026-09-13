import { dedupeParts } from "@timbre/core";

import type { Song } from "../types";

export interface TrackLike {
  id: string;
  title: string;
  artists: string[];
  isrc?: string | null;
}

function titleWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function normalizeName(value: string): string {
  return ` ${value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function sameArtist(seed: Song, found: Song): boolean {
  const seedNames = seed.artists.map(normalizeName).filter((name) => name.length > 3);
  const foundNames = found.artists.map(normalizeName).filter((name) => name.length > 3);
  if (seedNames.length === 0 || foundNames.length === 0) return true;

  const foundHay = normalizeName(`${found.artists.join(" ")} ${found.title}`);
  if (seedNames.some((name) => foundHay.includes(name))) return true;

  const seedHay = normalizeName(`${seed.artists.join(" ")} ${seed.title}`);
  return foundNames.some((name) => seedHay.includes(name));
}

function credited(seed: Song, found: Song): boolean {
  const foundArtists = normalizeName(found.artists.join(" "));
  return seed.artists.map(normalizeName).some((name) => name.length > 3 && foundArtists.includes(name));
}

function sameLength(seed: Song, found: Song): boolean {
  if (!seed.durationMs || !found.durationMs) return true;
  const gap = Math.abs(seed.durationMs - found.durationMs);
  if (!credited(seed, found)) return gap <= Math.max(10_000, seed.durationMs * 0.08);
  return gap <= Math.max(20_000, seed.durationMs * 0.25);
}

const VERSIONS: RegExp[] = [
  /\binstrumental\b|\bkaraoke\b|\boff\s*vocal\b|\bbacking\s+track\b/i,
  /\bcover(ed)?\b|\bsings\b|\bsung\s+by\b|\btribute\b|\bmade\s+famous\s+by\b|\brendition\b/i,
  /\bin\s+the\s+style\s+of\b/i,
  /\bremix\b|\bbootleg\b|\bmashup\b/i,
  /\blive\b|\ben\s+vivo\b|\bao\s+vivo\b|\bconcert\b|\btiny\s+desk\b|\bon\s+stage\b/i,
  /\bacoustic\b|\bunplugged\b|\bstripped\b|\bpiano\s+version\b|\ba\s*cappella\b|\bacapella\b/i,
  /\bsped\s*up\b|\bspeed\s*up\b|\bslowed\b|\bnightcore\b|\breverb\b|\b8d\b|\blo-?fi\b/i,
  /\bdemo\b/i,
];

// Reading `title` alone misses the versions that name themselves in the credit instead — a
// tribute act calls itself a tribute in its own name, and "made famous by" is a karaoke label
// that lives in the artist field. Both halves of both songs are read, so a seed that is itself
// a live cut still matches live copies of itself.
function versionText(song: Song): string {
  return `${song.title} ${song.artists.join(" ")}`;
}

function versionsAdded(seed: Song, found: Song): number {
  const wanted = versionText(seed);
  const got = versionText(found);
  return VERSIONS.filter((version) => version.test(got) && !version.test(wanted)).length;
}

function sameVersion(seed: Song, found: Song): boolean {
  return versionsAdded(seed, found) === 0;
}

export function plausiblySameSong(seed: Song, found: Song): boolean {
  if (!sameArtist(seed, found)) return false;
  if (!sameVersion(seed, found)) return false;
  if (!sameLength(seed, found)) return false;

  const wanted = titleWords(seed.title);
  if (wanted.length === 0) return true;

  const haystack = new Set(titleWords(`${found.title} ${found.artists.join(" ")}`));
  const hits = wanted.filter((word) => haystack.has(word)).length;

  return hits >= Math.max(2, Math.ceil(wanted.length / 2)) || hits === wanted.length;
}

// `plausiblySameSong` decides what is *not* this song; this decides which survivor to reach for
// first. It matters because `/api/search` ranks by popularity, so a famous live cut and a cover
// with a million views can both outrank the studio recording they are standing in for — and the
// ladder took whatever came back first. The two signals that separate them are cheap: a cover is
// usually credited to somebody else, and a live take is usually a different length.
function durationGap(seed: Song, found: Song): number {
  if (!seed.durationMs || !found.durationMs) return 0.5;
  return Math.min(1, Math.abs(seed.durationMs - found.durationMs) / Math.max(seed.durationMs, 1));
}

function closeness(seed: Song, found: Song): number {
  const sameIsrc = Boolean(seed.isrc && found.isrc && seed.isrc === found.isrc);
  const version = versionsAdded(seed, found);
  return (sameIsrc ? 4 : 0) + (credited(seed, found) ? 2 : 0) - version * 3 - durationGap(seed, found) * 2;
}

export function rankMatches(seed: Song, matches: Song[]): Song[] {
  return matches
    .map((found, order) => ({ found, order, score: closeness(seed, found) }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.found);
}

export function sameRecording(a: TrackLike, b: TrackLike): boolean {
  return alike(a, b, "ignore");
}

export function sameTrack(a: TrackLike, b: TrackLike): boolean {
  return alike(a, b, "respect");
}

function alike(a: TrackLike, b: TrackLike, variants: "ignore" | "respect"): boolean {
  if (a.id === b.id) return true;
  if (a.isrc && b.isrc) return a.isrc === b.isrc;

  const left = dedupeParts(a.title, a.artists);
  const right = dedupeParts(b.title, b.artists);
  if (!left.base || left.base !== right.base) return false;
  if (variants === "respect" && left.variants.join("+") !== right.variants.join("+")) return false;

  if (left.artists.length === 0 || right.artists.length === 0) return true;
  return left.artists.some((name) => right.artists.includes(name));
}
