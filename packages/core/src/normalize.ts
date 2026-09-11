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
  { pattern: /\bacoustic\b|\bunplugged\b/i, tag: "acoustic" },
  { pattern: /\bsession\b/i, tag: "session" },
  { pattern: /\binstrumental\b/i, tag: "instrumental" },
  { pattern: /\bkaraoke\b/i, tag: "karaoke" },
  { pattern: /\bdemo\b/i, tag: "demo" },
  { pattern: /\bcover\b/i, tag: "cover" },
  { pattern: /\bsped\s*up\b|\bslowed\b|\bnightcore\b/i, tag: "speed" },
  { pattern: /\bedit\b|\bradio\s+version\b/i, tag: "edit" },
  { pattern: /\bextended\b/i, tag: "extended" },
];

const FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?)\s+(.+)$/i;
const SEGMENT_FEATURE_PATTERN = /\b(?:feat\.?|featuring|ft\.?|with)\s+(.+)$/i;

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

export function parseTitle(raw: string) {
  const variants = new Set<string>();
  const featured: string[] = [];
  const stripFeature = (text: string, pattern: RegExp): string => {
    const match = pattern.exec(text);
    if (!match?.[1]) return text;
    featured.push(...splitArtists(match[1]));
    return text.slice(0, match.index);
  };

  const segments: string[] = [];
  const unbracketed = raw.replace(/[([{]([^)\]}]*)[)\]}]/g, (_match, inner: string) => {
    segments.push(inner);
    return " ";
  });
  const [main = unbracketed, ...suffixes] = unbracketed.split(/\s+[-–—]\s+/);
  segments.push(...suffixes);

  for (const segment of segments) {
    const text = stripFeature(segment, SEGMENT_FEATURE_PATTERN);
    const tagged = VARIANT_PATTERNS.filter(({ pattern }) => pattern.test(text));
    if (tagged.length > 0) {
      for (const { tag } of tagged) variants.add(tag);
      continue;
    }
    const residue = NOISE_PATTERNS.reduce((rest, pattern) => rest.replace(pattern, " "), text);
    const normalized = normalizeLoose(residue);
    if (normalized) variants.add(normalized);
  }

  const base = stripFeature(main, FEATURE_PATTERN).replace(TRAILING_NOISE, "");
  return {
    base: normalizeLoose(base),
    variants: [...variants].sort(),
    featured: [...new Set(featured.map(normalizeLoose).filter(Boolean))],
  };
}

function splitArtists(raw: string): string[] {
  return raw
    .split(/\s*(?:,|&|\+|\/|\bx\b|\bvs\.?\b|\band\b|\bwith\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeArtists(artists: string[]): string[] {
  return [...new Set(artists.flatMap(splitArtists).map(normalizeLoose).filter(Boolean))].sort();
}

export function dedupeParts(title: string, artists: string[]) {
  const { base, variants, featured } = parseTitle(title);
  return { base, variants, artists: normalizeArtists([...artists, ...featured]) };
}

export function dedupeKey(title: string, artists: string[]): string {
  const parts = dedupeParts(title, artists);
  return [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");
}

export function durationsMatch(a: number | null, b: number | null, toleranceMs = 3_000): boolean {
  return a === null || b === null || Math.abs(a - b) <= toleranceMs;
}
