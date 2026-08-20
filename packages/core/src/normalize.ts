/**
 * Title and artist normalization, and the fallback matcher when a track has no ISRC. One
 * distinction does the work: noise ("(Remastered 2011)", "[HD]") does not change the
 * recording, a variant ("(Live)", "- Remix") identifies a different one. Stripping noise
 * raises match rates; stripping variants swaps a studio track for a live cut, so variants
 * are extracted and compared, never discarded.
 */

/** Decorations safe to remove: same recording either way. */
const NOISE_PATTERNS: RegExp[] = [
  /\b(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\b/i,
  /\bremastered\s+version\b/i,
  /\b(?:deluxe|expanded|special|anniversary)(?:\s+edition)?\b/i,
  /\bbonus\s+track\b/i,
  /\b(?:mono|stereo)(?:\s+version)?\b/i,
  /\bofficial\s+(?:music\s+)?(?:video|audio|visualizer|lyric\s+video)\b/i,
  /\b(?:lyrics?|lyric\s+video|audio|visualizer)\b/i,
  /\bhq\b|\bhd\b|\b4k\b/i,
  /\bexplicit\b|\bclean\b/i,
  /\bfrom\s+["“].+?["”]\b/i,
];

/** Markers that mean "a different recording of this song". Never discarded. */
const VARIANT_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\bremix\b/i, tag: "remix" },
  { pattern: /\blive\b(?!\s*(?:from\s+the\s+studio))/i, tag: "live" },
  { pattern: /\bacoustic\b/i, tag: "acoustic" },
  { pattern: /\bunplugged\b/i, tag: "acoustic" },
  { pattern: /\bsession\b/i, tag: "session" },
  { pattern: /\binstrumental\b/i, tag: "instrumental" },
  { pattern: /\bkaraoke\b/i, tag: "karaoke" },
  { pattern: /\bdemo\b/i, tag: "demo" },
  { pattern: /\bcover\b/i, tag: "cover" },
  { pattern: /\bsped\s*up\b|\bslowed\b|\bnightcore\b/i, tag: "speed" },
  { pattern: /\bedit\b/i, tag: "edit" },
  { pattern: /\bextended\b/i, tag: "extended" },
  { pattern: /\bradio\s+(?:edit|version)\b/i, tag: "edit" },
];

const FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?|with)\s+(.+)$/i;

export interface ParsedTitle {
  /** Title with noise and variant markers removed, normalized for comparison. */
  base: string;
  /** Sorted, de-duplicated variant tags. Two tracks match only if these agree. */
  variants: string[];
  /** Artists pulled out of a "feat." clause in the title. */
  featured: string[];
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeLoose(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // strip combining marks left by NFKD
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Splits a raw title into base, variant tags and featured artists. Handles both the
 * "(Live)" and the trailing "- Live" forms. */
export function parseTitle(raw: string): ParsedTitle {
  const variants = new Set<string>();
  const featured: string[] = [];

  // Bracketed segments and any trailing " - suffix", which is how Spotify encodes what
  // YouTube puts in parentheses.
  const segments: string[] = [];
  let main = raw.replace(/[([{]([^)\]}]*)[)\]}]/g, (_match, inner: string) => {
    segments.push(inner);
    return " ";
  });

  const dashSplit = main.split(/\s+[-–—]\s+/);
  if (dashSplit.length > 1) {
    main = dashSplit[0] ?? main;
    segments.push(...dashSplit.slice(1));
  }

  const classify = (text: string): void => {
    const feature = FEATURE_PATTERN.exec(text);
    if (feature?.[1]) {
      featured.push(...splitArtists(feature[1]));
      return;
    }

    let recognized = false;
    for (const { pattern, tag } of VARIANT_PATTERNS) {
      if (pattern.test(text)) {
        variants.add(tag);
        recognized = true;
      }
    }
    if (recognized) return;

    // Unrecognized bracketed text is kept as a variant: dropping it makes "Wonderwall
    // (Unplugged)" identical to "Wonderwall". The list can never be complete, so anything not
    // understood distinguishes the recording. Noise is stripped first, so "(Remastered 2011)"
    // reduces to nothing and is correctly ignored.
    let residue = text;
    for (const pattern of NOISE_PATTERNS) residue = residue.replace(pattern, " ");
    const normalized = normalizeLoose(residue);
    if (normalized) variants.add(normalized);
  };

  for (const segment of segments) classify(segment);

  // A "feat." clause can also sit inline in the main title with no brackets.
  const inlineFeature = FEATURE_PATTERN.exec(main);
  if (inlineFeature?.[1]) {
    featured.push(...splitArtists(inlineFeature[1]));
    main = main.slice(0, inlineFeature.index);
  }

  let base = main;
  for (const pattern of NOISE_PATTERNS) base = base.replace(pattern, " ");

  return {
    base: normalizeLoose(base),
    variants: [...variants].sort(),
    featured: dedupe(featured.map(normalizeLoose).filter(Boolean)),
  };
}

/** Splits "A, B & C" / "A x B" / "A vs B" into individual artist names. */
export function splitArtists(raw: string): string[] {
  return raw
    .split(/\s*(?:,|&|\+|\/|\bx\b|\bvs\.?\b|\band\b|\bwith\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Canonical comparable form of an artist credit list. */
export function normalizeArtists(artists: string[]): string[] {
  return dedupe(artists.flatMap(splitArtists).map(normalizeLoose).filter(Boolean)).sort();
}

/** The pieces a dedupe key is built from, for callers that need to compare them separately.
 * Merging has to tell "same song, one catalogue also names the guest" apart from "different
 * song", and a joined string cannot say which part differed. */
export function dedupeParts(
  title: string,
  artists: string[],
): { base: string; variants: string[]; artists: string[] } {
  const parsed = parseTitle(title);
  return {
    base: parsed.base,
    variants: parsed.variants,
    artists: normalizeArtists([...artists, ...parsed.featured]),
  };
}

/** Stable identity for local deduplication: same base title, variants and artists.
 * The fallback when a provider gives no ISRC, which is most of YouTube Music. */
export function dedupeKey(title: string, artists: string[]): string {
  const parts = dedupeParts(title, artists);
  return [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");
}

/** Durations agree within a tolerance. Providers disagree by a second or two. */
export function durationsMatch(
  a: number | null,
  b: number | null,
  toleranceMs = 3_000,
): boolean {
  // Unknown duration is not evidence of a mismatch, so do not penalize it.
  if (a === null || b === null) return true;
  return Math.abs(a - b) <= toleranceMs;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
