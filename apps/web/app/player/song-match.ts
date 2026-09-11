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
  /\bcover\b|\bsings\b|\bsung\s+by\b/i,
  /\bremix\b/i,
  /\blive\b/i,
  /\bacoustic\b|\bunplugged\b/i,
  /\bsped\s*up\b|\bspeed\s*up\b|\bslowed\b|\bnightcore\b|\breverb\b|\b8d\b/i,
];

function sameVersion(seed: Song, found: Song): boolean {
  return VERSIONS.every((version) => !version.test(found.title) || version.test(seed.title));
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
