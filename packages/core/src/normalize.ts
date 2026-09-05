/**
 * Title and artist normalization, and the fallback matcher when a track has no ISRC. One
 * distinction does the work: noise ("(Remastered 2011)", "[HD]") does not change the
 * recording, a variant ("(Live)", "- Remix") identifies a different one. Stripping noise
 * raises match rates; stripping variants swaps a studio track for a live cut, so variants
 * are extracted and compared, never discarded.
 */

/** Decorations safe to remove: same recording either way. */
const NOISE_PATTERNS: RegExp[] = [
  // One pattern for the whole reissue vocabulary, because two overlapping ones left residue:
  // the first ate "Remastered" out of "Remastered Version" before the second could see it,
  // and "(Deluxe Version)" and "(30th Anniversary Edition)" kept a "version" or a "30th"
  // that then counted as a variant — so none of them merged with the plain title.
  /\b(?:\d{4}\s+|\d+(?:st|nd|rd|th)\s+)?(?:remaster(?:ed)?|deluxe|expanded|special|anniversary)(?:\s+\d{4})?(?:\s+(?:version|edition|remaster(?:ed)?))?\b/i,
  /\bbonus\s+track\b/i,
  /\b(?:mono|stereo)(?:\s+version)?\b/i,
  /\bofficial\s+(?:music\s+)?(?:video|audio|visualizer|lyric\s+video)\b/i,
  /\b(?:lyrics?|lyric\s+video|audio|visualizer)\b/i,
  /\bhq\b|\bhd\b|\b4k\b/i,
  /\bexplicit\b|\bclean\b/i,
  /\bfrom\s+["“][^"”]+["”]/i,
];

/** The same words, as a run at the end of a title. See `parseTitle` for why only there. */
const TRAILING_NOISE = new RegExp(
  `(?:\\s+(?:${NOISE_PATTERNS.map((pattern) => pattern.source).join("|")}))+\\s*$`,
  "i",
);

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

/**
 * A guest credit, by a marker that can only ever mean one. Safe to look for anywhere in a
 * title, because none of these words is ordinary English in this position.
 */
const FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?)\s+(.+)$/i;

/**
 * The same, plus a bare `with` — and **only** for a bracketed segment or a trailing
 * `- suffix`, which is already known to be an aside rather than part of the sentence.
 *
 * `with` is an ordinary preposition, so looking for it inline read the middle of a title as
 * a credit list: *Stay With Me* parsed to base `stay` featuring `me`, *Dancing With Myself*
 * to `dancing` featuring `myself`, and *The Girl With The Faraway Eyes* to `the girl`
 * featuring `the faraway eyes`. That is wrong in three places at once — it is the title the
 * lyrics route asks LRCLIB for, so those songs looked up the wrong words entirely; it puts
 * a noun into the credits that `normalizeArtists` then compares against real names; and it
 * truncates the base a merge is keyed on, so a song and a longer song starting with it
 * could collapse into one row.
 *
 * `(with Ariana Grande)` — the form that actually means a guest — is bracketed, and is
 * unaffected.
 */
const SEGMENT_FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?|with)\s+(.+)$/i;

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
    const feature = SEGMENT_FEATURE_PATTERN.exec(text);
    if (feature?.[1]) {
      featured.push(...splitArtists(feature[1]));
      // The credit is the tail of the segment, not the whole of it: "(Live with Orchestra)"
      // and "(Remix feat. Rosalía)" name a guest *and* a different recording. Returning here
      // discarded the variant, and the live cut merged into the studio take with nothing but
      // the duration guard in the way — the one thing this module exists to prevent.
      text = text.slice(0, feature.index);
      if (!text.trim()) return;
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

  // A "feat." clause can also sit inline in the main title with no brackets. Only the
  // unambiguous markers here — see `SEGMENT_FEATURE_PATTERN` for why `with` is not one.
  const inlineFeature = FEATURE_PATTERN.exec(main);
  if (inlineFeature?.[1]) {
    featured.push(...splitArtists(inlineFeature[1]));
    main = main.slice(0, inlineFeature.index);
  }

  // Only a *trailing* run of noise comes off the main title. Stripping it anywhere hollowed
  // out a title that is itself a noise word — "Clean", "Audio", "Special" reduced to nothing,
  // so every such song by one artist shared a key and LRCLIB was asked for an empty track
  // name — and took the front off "Stereo Hearts". Decoration on an unbracketed title
  // ("Wonderwall Official Video") is at the end, which is where this looks.
  const base = main.replace(TRAILING_NOISE, "");

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
