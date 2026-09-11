import { ALLOWED_HOSTS } from "@/lib/artwork-proxy";

export function proxied(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  if (!url.startsWith("https://")) return url;

  try {
    if (!ALLOWED_HOSTS.has(new URL(url).hostname)) return url;
  } catch {
    return url;
  }

  return `/api/art?u=${encodeURIComponent(url)}`;
}

const DEEZER_DIMENSIONS = /\/(\d+)x(\d+)(-[^/]*)?\.(jpg|jpeg|png|webp)$/i;

const RESIZABLE_HOSTS = /(^|\.)dzcdn\.net$/i;

export function sized(url: string | null | undefined, px: number): string | null {
  if (typeof url !== "string" || !url) return null;

  try {
    if (!RESIZABLE_HOSTS.test(new URL(url).hostname)) return url;
  } catch {
    return url;
  }

  return url.replace(DEEZER_DIMENSIONS, (whole, width: string, _height, rest, extension: string) =>
    Number(width) > px ? `/${px}x${px}${rest ?? ""}.${extension}` : whole,
  );
}

export function cover(url: string | null | undefined, px: number): string | null {
  return proxied(sized(url, px));
}
