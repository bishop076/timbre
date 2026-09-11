const NOISE_PATTERNS: RegExp[] = [
  /\b(?:\d{4}\s+|\d+(?:st|nd|rd|th)\s+)?(?:remaster(?:ed)?|deluxe|expanded|special|anniversary)(?:\s+\d{4})?(?:\s+(?:version|edition|remaster(?:ed)?))?\b/i,
  /\bbonus\s+track\b/i,
  /\b(?:mono|stereo)(?:\s+version)?\b/i,
  /\bofficial\s+(?:music\s+)?(?:video|audio|visualizer|lyric\s+video)\b/i,
  /\b(?:lyrics?|lyric\s+video|audio|visualizer)\b/i,
  /\bhq\b|\bhd\b|\b4k\b/i,
  /\bexplicit\b|\bclean\b/i,
  /\bfrom\s+["“][^"”]+["”]/i,
];

const TRAILING_NOISE = new RegExp(
  `(?:\\s+(?:${NOISE_PATTERNS.map((pattern) => pattern.source).join("|")}))+\\s*$`,
  "i",
);

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

const FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?)\s+(.+)$/i;

const SEGMENT_FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?|with)\s+(.+)$/i;

export interface ParsedTitle {
  base: string;
  variants: string[];
  featured: string[];
}

export function normalizeLoose(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseTitle(raw: string): ParsedTitle {
  const variants = new Set<string>();
  const featured: string[] = [];

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

    let residue = text;
    for (const pattern of NOISE_PATTERNS) residue = residue.replace(pattern, " ");
    const normalized = normalizeLoose(residue);
    if (normalized) variants.add(normalized);
  };

  for (const segment of segments) classify(segment);

  const inlineFeature = FEATURE_PATTERN.exec(main);
  if (inlineFeature?.[1]) {
    featured.push(...splitArtists(inlineFeature[1]));
    main = main.slice(0, inlineFeature.index);
  }

  const base = main.replace(TRAILING_NOISE, "");

  return {
    base: normalizeLoose(base),
    variants: [...variants].sort(),
    featured: dedupe(featured.map(normalizeLoose).filter(Boolean)),
  };
}

export function splitArtists(raw: string): string[] {
  return raw
    .split(/\s*(?:,|&|\+|\/|\bx\b|\bvs\.?\b|\band\b|\bwith\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeArtists(artists: string[]): string[] {
  return dedupe(artists.flatMap(splitArtists).map(normalizeLoose).filter(Boolean)).sort();
}

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

export function dedupeKey(title: string, artists: string[]): string {
  const parts = dedupeParts(title, artists);
  return [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");
}

export function durationsMatch(
  a: number | null,
  b: number | null,
  toleranceMs = 3_000,
): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a - b) <= toleranceMs;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
