import { allowed } from "@/lib/artwork-proxy";

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function proxied(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  const target = parse(url);
  // `allowed` rather than the bare host set, so this never hands the proxy a URL it will
  // refuse — the two agree on the path rules as well as the hosts.
  //
  // An unlisted host returns null rather than the URL itself. Passing it through was the
  // failure this function exists to prevent: the browser then fetches the cover straight
  // from a host nobody vetted, handing it the reader's address and user agent, past the
  // proxy's allowlist, size cap and content-type check. S-21 fixed the provider that was
  // minting such URLs; this closes the door behind it rather than trusting that every
  // future provider remembers. Callers render the note-icon placeholder for null, which is
  // the same thing they already show for a song with no artwork at all.
  return target && allowed(target) ? `/api/art?u=${encodeURIComponent(url)}` : null;
}

const square = (side: number) => `${side}x${side}`;

const RESIZERS: { size: RegExp; name: (side: number) => string; sides?: readonly number[] }[] = [
  {
    size: /(?<=^https:\/\/(?:[^/]+\.)?dzcdn\.net\/.*\/)(\d+)x\d+(?=(?:-[^/]*)?\.(?:jpg|jpeg|png|webp)$)/i,
    name: square,
  },
  { size: /(?<=^https:\/\/thumbnailer\.mixcloud\.com\/unsafe\/)(\d+)x\d+(?=\/)/, name: square },
  { size: /(?<=^https:\/\/is\d-ssl\.mzstatic\.com\/.*\/)(\d+)x\d+(?=bb\.)/, name: square },
  {
    size: /(?<=^https:\/\/lh3\.googleusercontent\.com\/.*=)w(\d+)-h\1(?=-|$)/,
    name: (side) => `w${side}-h${side}`,
  },
  {
    size: /(?<=^https:\/\/[^/]+\/content\/[^/]+\/)(\d+)x\1(?=\.jpg$)/,
    name: square,
    sides: [150, 480, 1000],
  },
  {
    size: /(?<=^https:\/\/i\d\.sndcdn\.com\/.*-)t(\d+)x\1(?=\.)/,
    name: (side) => (side === 100 ? "large" : `t${side}x${side}`),
    sides: [100, 300, 500],
  },
];

export function sized(url: string | null | undefined, px: number): string | null {
  if (typeof url !== "string" || !url) return null;
  for (const { size, name, sides } of RESIZERS) {
    const width = size.exec(url)?.[1];
    if (!width) continue;
    const side = sides ? sides.find((candidate) => candidate >= px) : px;
    return side && side < Number(width) ? url.replace(size, name(side)) : url;
  }
  return url;
}

export function cover(url: string | null | undefined, px: number): string | null {
  return proxied(sized(url, px));
}
