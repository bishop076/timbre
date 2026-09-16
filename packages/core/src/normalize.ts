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

/**
 * One trailing tag, anchored to the end of the string — and peeled off one at a time.
 *
 * The obvious spelling is the whole run in a single pattern,
 * `(?:\s+(?:<tag>|<tag>|…))+\s*$`, and that one backtracks catastrophically. The first
 * alternative ends in two optional groups, `(?:\s+\d{4})?` and
 * `(?:\s+(?:version|edition|remaster(?:ed)?))?`, so `remaster remaster` is both one
 * repetition of it and two — and N of them are 2^N different ways to divide the same text.
 * On a title that ends in something the run cannot swallow the engine tries all of them:
 * `"song" + " remaster".repeat(32) + " zz"` is 300 characters, the exact cap
 * `/api/lyrics` already enforces on its `title`, and it took 3.0 seconds to say no.
 * `dedupeKey` on 367 characters of it — the search merge path, which has no cap at all —
 * took 139 seconds. Both block the event loop for the whole instance.
 *
 * Without the `+` there is nothing to divide: each pass tries the alternation once per
 * starting position and stops. The result is the same string, because a run of tags is the
 * same whether it comes off in one piece or in several.
 */
const TRAILING_NOISE = new RegExp(
  `\\s+(?:${NOISE_PATTERNS.map((pattern) => pattern.source).join("|")})\\s*$`,
  "i",
);

function stripTrailingNoise(text: string): string {
  let rest = text;
  for (;;) {
    const stripped = rest.replace(TRAILING_NOISE, "");
    if (stripped === rest) return rest;
    rest = stripped;
  }
}

/**
 * The ways a recording says it is not the plain studio take.
 *
 * Every spelling of a tag folds onto the one tag, because the tag is what callers compare:
 * `mergeTracks` refuses to fold two different tags into one song, and the search ranker demotes
 * a tag the reader did not ask for. A tribute act and a karaoke label are saying "cover" and
 * "instrumental" in their own words; spelling them separately would only mean a cover that
 * called itself a rendition escaped both.
 */
const VARIANT_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /\bremix\b|\bbootleg\b|\bmash-?up\b|\bre-?work\b/i, tag: "remix" },
  {
    pattern:
      /\blive\b(?!\s*(?:from\s+the\s+studio))|\ben\s+vivo\b|\bao\s+vivo\b|\bconcert\b|\btiny\s+desk\b|\bon\s+stage\b/i,
    tag: "live",
  },
  {
    pattern:
      /\bacoustic\b|\bunplugged\b|\bstripped\b|\bpiano\s+version\b|\ba\s*cappella\b|\bacapella\b/i,
    tag: "acoustic",
  },
  { pattern: /\bsession\b/i, tag: "session" },
  { pattern: /\binstrumental\b|\boff\s*vocal\b|\bbacking\s+track\b/i, tag: "instrumental" },
  { pattern: /\bkaraoke\b|\bmade\s+famous\s+by\b|\bin\s+the\s+style\s+of\b/i, tag: "karaoke" },
  { pattern: /\bdemo\b/i, tag: "demo" },
  { pattern: /\bcover(?:ed)?\b|\btribute\b|\brendition\b|\bsung\s+by\b/i, tag: "cover" },
  {
    pattern: /\bsped\s*up\b|\bspeed\s*up\b|\bslowed\b|\bnightcore\b|\breverb\b|\b8d\b|\blo-?fi\b/i,
    tag: "speed",
  },
  { pattern: /\bedit\b|\bradio\s+version\b/i, tag: "edit" },
  { pattern: /\bextended\b/i, tag: "extended" },
];

// Every variant pattern again, this time able to match more than once in a string, because
// `parseVersions` takes the words out rather than only asking whether they are there. Compiled
// once: the search ranker asks this of every row of every result set.
const EVERY_VARIANT = VARIANT_PATTERNS.map(({ pattern, tag }) => ({
  pattern: new RegExp(pattern.source, "gi"),
  tag,
}));

/**
 * How much of a title `parseTitle` will read.
 *
 * Nothing upstream bounds one. `mergeTracks` hands it every `title` a provider returns, and
 * SoundCloud, Audius, Archive and Mixcloud titles are typed by whoever uploaded the track;
 * `/api/lyrics` caps its own query at 300 characters but nothing caps that path. The bracket
 * scan below is quadratic in what it is given — `"(".repeat(40_000)` costs 7.3 seconds in the
 * regex alone, on the one thread answering everybody — so the length has to stop somewhere.
 * 500 is well past the longest real title and leaves the scan at about a thousandth of that.
 */
const MAX_TITLE = 500;

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

/**
 * The version tags a piece of free text claims, and the text left once they are taken out.
 *
 * Both halves answer a question the search ranker asks. A result carrying a tag the query never
 * asked for is a live cut or a cover standing in for the song; the remainder is the song the
 * reader typed. "wonderwall live" asks for `wonderwall` *and* for `live`, so the two have to
 * come apart before either can be compared with a result.
 */
export function parseVersions(text: string): { tags: string[]; rest: string } {
  const tags = new Set<string>();
  let rest = text;
  for (const { pattern, tag } of EVERY_VARIANT) {
    const stripped = rest.replace(pattern, " ");
    if (stripped === rest) continue;
    tags.add(tag);
    rest = stripped;
  }
  return { tags: [...tags].sort(), rest };
}

export function versionTags(text: string): string[] {
  return parseVersions(text).tags;
}

/**
 * `credits` are the names the source already puts in its own artist field, and they are here to
 * settle what a dash means. Splitting on " - " and filing the rest as a variant is right for
 * `Wonderwall - Remastered` and wrong for SoundCloud, Audius and Mixcloud, where `Artist -
 * Title` — and, less often, `Title - Artist` — is how an uploader writes a filename. `Jóga -
 * Björk` parsed to `{ base: "joga", variants: ["bjork"] }` and `Nirvana - Smells Like Teen
 * Spirit` to a song called `nirvana`, so neither could merge with the catalogue copy of the same
 * recording: one song arrived as two rows, each holding half its sources.
 *
 * A segment is only dropped when it names an artist the track itself credits, which is the whole
 * of the evidence that it is a byline rather than a version. `Wonderwall - Live` keeps its
 * variant, and so does `Jóga - Björk` on a track credited to somebody else, because there the
 * dash really is saying something about the recording.
 */
export function parseTitle(raw: string, credits: string[] = []) {
  const title = raw.slice(0, MAX_TITLE);
  const variants = new Set<string>();
  const featured: string[] = [];
  const stripFeature = (text: string, pattern: RegExp): string => {
    const match = pattern.exec(text);
    if (!match?.[1]) return text;
    featured.push(...splitArtists(match[1]));
    return text.slice(0, match.index);
  };

  const segments: string[] = [];
  const unbracketed = title.replace(/[([{]([^)\]}]*)[)\]}]/g, (_match, inner: string) => {
    segments.push(inner);
    return " ";
  });

  const credited = new Set(normalizeArtists(credits));
  const isByline = (segment: string): boolean => {
    if (credited.size === 0) return false;
    const names = splitArtists(segment).map(normalizeLoose).filter(Boolean);
    return names.length > 0 && names.every((name) => credited.has(name));
  };

  const pieces = unbracketed.split(/\s+[-–—]\s+/);
  while (pieces.length > 1 && isByline(pieces[pieces.length - 1]!)) pieces.pop();
  while (pieces.length > 1 && isByline(pieces[0]!)) pieces.shift();

  const [main = unbracketed, ...suffixes] = pieces;
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

  const base = stripTrailingNoise(stripFeature(main, FEATURE_PATTERN));
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
  const { base, variants, featured } = parseTitle(title, artists);
  return { base, variants, artists: normalizeArtists([...artists, ...featured]) };
}

export function dedupeKey(title: string, artists: string[]): string {
  const parts = dedupeParts(title, artists);
  return [parts.base, parts.variants.join("+"), parts.artists.join("+")].join("|");
}

export function durationsMatch(a: number | null, b: number | null, toleranceMs = 3_000): boolean {
  return a === null || b === null || Math.abs(a - b) <= toleranceMs;
}

/**
 * An ISRC reduced to the twelve characters it actually is, or null if it isn't one.
 *
 * The standard is written `CC-XXX-YY-NNNNN` and spelled by each source however it likes:
 * Deezer emits it bare, while SoundCloud's (`publisher_metadata.isrc`) and Audius's are typed
 * by the uploader, hyphens, lower case and all. Compared byte for byte, `gb-aaw-95-00189` and
 * `GBAAW9500189` are two different recordings — which split one song into two rows, each
 * holding half its sources, so a song with a playable copy could present as one without.
 *
 * Anything that is not an ISRC comes back null rather than being trusted as an identity: this
 * value is a merge key *and* the song's id, so a free-text field full of something else must
 * not decide either.
 */
export function normalizeIsrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const bare = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(bare) ? bare : null;
}
