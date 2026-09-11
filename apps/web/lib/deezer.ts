import "server-only";

export interface RawTrack {
  id: number;
  title: string;
  duration?: number;
  isrc?: string;
  rank?: number;
  position?: number;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

export async function deezer<T>(path: string, revalidateSeconds = 86_400): Promise<T | null> {
  try {
    const response = await fetch(`https://api.deezer.com${path}`, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: revalidateSeconds },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as T & { error?: unknown };
    return body && "error" in body && body.error ? null : body;
  } catch {
    return null;
  }
}

export async function deezerList<T>(path: string, revalidateSeconds?: number): Promise<T[]> {
  return (await deezer<{ data?: T[] }>(path, revalidateSeconds))?.data ?? [];
}

export async function fetchChartTracks(genre: number | string): Promise<RawTrack[]> {
  const chart = await deezer<{ tracks?: { data?: RawTrack[] } }>(`/chart/${genre}?limit=50`, 3_600);
  return chart?.tracks?.data ?? [];
}

export function newestFirst(a: { release_date?: string }, b: { release_date?: string }): number {
  return (b.release_date ?? "").localeCompare(a.release_date ?? "");
}
