import { ALLOWED_HOSTS } from "@/lib/artwork-proxy";

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function proxied(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !url) return null;
  const host = url.startsWith("https://") ? hostname(url) : null;
  return host && ALLOWED_HOSTS.has(host) ? `/api/art?u=${encodeURIComponent(url)}` : url;
}

const DEEZER_DIMENSIONS = /\/(\d+)x(\d+)(-[^/]*)?\.(jpg|jpeg|png|webp)$/i;

const RESIZABLE_HOSTS = /(^|\.)dzcdn\.net$/i;

export function sized(url: string | null | undefined, px: number): string | null {
  if (typeof url !== "string" || !url) return null;
  if (!RESIZABLE_HOSTS.test(hostname(url) ?? "")) return url;
  return url.replace(DEEZER_DIMENSIONS, (whole, width: string, _height, rest, extension: string) =>
    Number(width) > px ? `/${px}x${px}${rest ?? ""}.${extension}` : whole,
  );
}

export function cover(url: string | null | undefined, px: number): string | null {
  return proxied(sized(url, px));
}
