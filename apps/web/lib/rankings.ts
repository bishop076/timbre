import "server-only";

import { listProviders, scoreCandidates, type RankedList } from "@timbre/providers";

import { deezer } from "./deezer";
import { bandOf } from "./rank-bands";
import { getProviderRuntime } from "./providers";

export interface RankedSong {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: { source: string; sourceId: string; url: string | null; playback: "link" }[];
  position: number;
  charts: string[];
  positions: Record<string, number>;
}

export interface Rankings {
  songs: RankedSong[];
  charts: string[];
  failed: string[];
}

function keyOf(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

export async function fetchRankings(limit = 100): Promise<Rankings> {
  const { limiter } = getProviderRuntime();
  const providers = listProviders().filter((provider) => provider.chart !== undefined);

  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({
      list: provider.id,
      tracks: await provider.chart!({ limiter, revalidate: 3_600 }, limit),
    })),
  );

  const lists: RankedList[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value.tracks.length > 0) {
      lists.push(result.value);
    } else {
      failed.push(providers[index]!.id);
    }
  });

  if (lists.length === 0) return { songs: [], charts: [], failed };

  const ranks = new Map<string, number>();
  for (const entry of lists) {
    entry.tracks.forEach((track, index) => {
      ranks.set(keyOf(track.source, track.sourceId), index + 1);
    });
  }

  const scored = scoreCandidates(lists)
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    charts: lists.map((entry) => entry.list),
    failed,
    songs: scored.map(({ song }, index) => {
      const positions: Record<string, number> = {};
      for (const source of song.sources) {
        const rank = ranks.get(keyOf(source.source, source.sourceId));
        if (rank !== undefined) positions[source.source] = rank;
      }

      return {
        id: song.id,
        title: song.title,
        artists: song.artists,
        album: song.album,
        durationMs: song.durationMs,
        isrc: song.isrc,
        artworkUrl: song.artworkUrl,
        sources: song.sources.map((source) => ({
          source: source.source,
          sourceId: source.sourceId,
          url: source.url,
          playback: "link" as const,
        })),
        position: index + 1,
        charts: Object.keys(positions),
        positions,
      };
    }),
  };
}

export interface GenreMix {
  genre: string;
  total: number;
  bands: number[];
}

export interface GenreChart {
  id: number;
  genre: string;
  trackIds: string[];
}

export async function fetchGenreCharts(genres: number): Promise<GenreChart[]> {
  const list = await deezer<{ data?: { id: number; name: string }[] }>("/genre", 604_800);
  const candidates = (list?.data ?? []).filter((entry) => entry.id !== 0).slice(0, genres);

  return Promise.all(
    candidates.map(async (genre) => {
      const chart = await deezer<{ tracks?: { data?: { id: number }[] } }>(
        `/chart/${genre.id}?limit=50`,
        3_600,
      );

      return {
        id: genre.id,
        genre: genre.name,
        trackIds: (chart?.tracks?.data ?? []).map((track) => String(track.id)),
      };
    }),
  );
}

export function mixGenres(charts: GenreChart[], songs: RankedSong[]): GenreMix[] {
  const placed = new Map<string, number>();
  for (const song of songs) {
    for (const source of song.sources) {
      if (source.source === "deezer") placed.set(source.sourceId, song.position);
    }
  }
  if (placed.size === 0) return [];

  const mixes = charts.map((chart) => {
    const bands = [0, 0, 0, 0];
    let total = 0;
    for (const id of chart.trackIds) {
      const position = placed.get(id);
      if (position === undefined) continue;
      bands[bandOf(position)]! += 1;
      total += 1;
    }

    return { genre: chart.genre, total, bands };
  });

  return mixes.filter((mix) => mix.total > 0).sort((a, b) => b.total - a.total);
}

export function genresBySong(charts: GenreChart[], songs: RankedSong[]): Record<string, number[]> {
  const byTrack = new Map<string, number[]>();
  for (const chart of charts) {
    for (const id of chart.trackIds) {
      const genres = byTrack.get(id);
      if (genres) genres.push(chart.id);
      else byTrack.set(id, [chart.id]);
    }
  }

  const out: Record<string, number[]> = {};
  for (const song of songs) {
    const genres = new Set<number>();
    for (const source of song.sources) {
      if (source.source !== "deezer") continue;
      for (const genre of byTrack.get(source.sourceId) ?? []) genres.add(genre);
    }
    if (genres.size > 0) out[song.id] = [...genres];
  }
  return out;
}

export function shareByArtist(
  songs: RankedSong[],
): { artist: string; entries: number; best: number }[] {
  const counts = new Map<string, { entries: number; best: number }>();

  for (const song of songs) {
    const artist = song.artists[0];
    if (!artist) continue;
    const seen = counts.get(artist);
    if (seen) {
      seen.entries += 1;
      seen.best = Math.min(seen.best, song.position);
    } else {
      counts.set(artist, { entries: 1, best: song.position });
    }
  }

  return [...counts.entries()]
    .map(([artist, value]) => ({ artist, ...value }))
    .sort((a, b) => b.entries - a.entries || a.best - b.best);
}

export function agreement(rankings: Rankings): {
  shared: number;
  only: { chart: string; count: number }[];
  total: number;
} {
  const only = new Map<string, number>();
  let shared = 0;

  for (const song of rankings.songs) {
    if (song.charts.length > 1) {
      shared += 1;
      continue;
    }
    const chart = song.charts[0];
    if (chart) only.set(chart, (only.get(chart) ?? 0) + 1);
  }

  return {
    shared,
    only: rankings.charts.map((chart) => ({ chart, count: only.get(chart) ?? 0 })),
    total: rankings.songs.length,
  };
}
