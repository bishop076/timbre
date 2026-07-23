/**
 * Title and artist normalization.
 *
 * Used for deduplication now, and as the fallback matcher in Phase 2 when a
 * track has no ISRC. The whole design rests on one distinction:
 *
 *   noise    — decorations that do not change the recording.
 *              "(Remastered 2011)", "(Official Video)", "[HD]"
 *   variant  — markers that identify a *different* recording.
 *              "(Live)", "(Acoustic)", "- Kaytranada Remix"
 *
 * Stripping noise raises match rates. Stripping variants silently swaps a
 * user's studio track for a live cut, which is the single most damaging bug a
 * playlist transfer can have — so variants are extracted and compared, never
 * discarded.
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

/**
 * Splits a raw title into its comparable base, its variant tags, and any
 * featured artists. Handles the bracketed form "(Live)" and the trailing
 * dash form "- Live", both of which are common across all three services.
 */
export function parseTitle(raw: string): ParsedTitle {
  const variants = new Set<string>();
  const featured: string[] = [];

  // Pull apart bracketed segments and any trailing " - suffix" clause, which
  // is how Spotify encodes what YouTube usually puts in parentheses.
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
    for (const { pattern, tag } of VARIANT_PATTERNS) {
      if (pattern.test(text)) variants.add(tag);
    }
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

/**
 * Stable identity for local deduplication: same base title, same variants,
 * same primary artist. Not a substitute for ISRC — it is what we fall back to
 * when the provider gives us no ISRC at all, which is most of YouTube Music.
 */
export function dedupeKey(title: string, artists: string[]): string {
  const parsed = parseTitle(title);
  const allArtists = normalizeArtists([...artists, ...parsed.featured]);
  return [parsed.base, parsed.variants.join("+"), allArtists.join("+")].join("|");
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
