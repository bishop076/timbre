import "server-only";

import { listProviders, scoreCandidates, type RankedList } from "@timbre/providers";

import { fetchChartTracks } from "./deezer";
import { fetchGenres, type LinkedSong } from "./discover";
import { bandOf } from "./rank-bands";
import { getProviderRuntime } from "./providers";

export interface RankedSong extends LinkedSong {
  position: number;
  charts: string[];
  positions: Record<string, number>;
}

export interface Rankings {
  songs: RankedSong[];
  charts: string[];
  failed: string[];
}

export interface GenreMix {
  genre: string;
  total: number;
  bands: number[];
}

interface GenreChart {
  id: number;
  genre: string;
  trackIds: string[];
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
    if (result.status === "fulfilled" && result.value.tracks.length > 0) lists.push(result.value);
    else failed.push(providers[index]!.id);
  });

  if (lists.length === 0) return { songs: [], charts: [], failed };

  const ranks = new Map<string, number>();
  for (const entry of lists) {
    entry.tracks.forEach((track, index) => ranks.set(`${track.source}:${track.sourceId}`, index + 1));
  }

  const scored = scoreCandidates(lists)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    charts: lists.map((entry) => entry.list),
    failed,
    songs: scored.map(({ song }, index) => {
      const positions: Record<string, number> = {};
      for (const { source, sourceId } of song.sources) {
        const rank = ranks.get(`${source}:${sourceId}`);
        if (rank !== undefined) positions[source] = rank;
      }

      return {
        id: song.id,
        title: song.title,
        artists: song.artists,
        album: song.album,
        durationMs: song.durationMs,
        isrc: song.isrc,
        artworkUrl: song.artworkUrl,
        sources: song.sources.map(({ source, sourceId, url }) => ({
          source,
          sourceId,
          url,
          playback: "link" as const,
        })),
        position: index + 1,
        charts: Object.keys(positions),
        positions,
      };
    }),
  };
}

export async function fetchGenreCharts(genres: number): Promise<GenreChart[]> {
  const candidates = (await fetchGenres()).filter((entry) => entry.id !== 0).slice(0, genres);

  return Promise.all(
    candidates.map(async ({ id, name }) => ({
      id,
      genre: name,
      trackIds: (await fetchChartTracks(id)).map((track) => String(track.id)),
    })),
  );
}

function deezerIds(song: RankedSong): string[] {
  return song.sources.flatMap(({ source, sourceId }) => (source === "deezer" ? [sourceId] : []));
}

export function mixGenres(charts: GenreChart[], songs: RankedSong[]): GenreMix[] {
  const placed = new Map<string, number>();
  for (const song of songs) {
    for (const id of deezerIds(song)) placed.set(id, song.position);
  }
  if (placed.size === 0) return [];

  return charts
    .map((chart) => {
      const bands = [0, 0, 0, 0];
      for (const id of chart.trackIds) {
        const position = placed.get(id);
        if (position !== undefined) bands[bandOf(position)]! += 1;
      }
      return { genre: chart.genre, total: bands.reduce((sum, count) => sum + count, 0), bands };
    })
    .filter((mix) => mix.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function genresBySong(charts: GenreChart[], songs: RankedSong[]): Record<string, number[]> {
  const byTrack = new Map<string, number[]>();
  for (const chart of charts) {
    for (const id of chart.trackIds) byTrack.set(id, [...(byTrack.get(id) ?? []), chart.id]);
  }

  const out: Record<string, number[]> = {};
  for (const song of songs) {
    const genres = new Set(deezerIds(song).flatMap((id) => byTrack.get(id) ?? []));
    if (genres.size > 0) out[song.id] = [...genres];
  }
  return out;
}

export function shareByArtist(songs: RankedSong[]) {
  const counts = new Map<string, { artist: string; entries: number; best: number }>();

  for (const { artists: [artist], position } of songs) {
    if (!artist) continue;
    const seen = counts.get(artist);
    counts.set(artist, {
      artist,
      entries: (seen?.entries ?? 0) + 1,
      best: Math.min(seen?.best ?? position, position),
    });
  }

  return [...counts.values()].sort((a, b) => b.entries - a.entries || a.best - b.best);
}

export function agreement(rankings: Rankings) {
  const only = new Map<string, number>();
  let shared = 0;

  for (const song of rankings.songs) {
    const [chart] = song.charts;
    if (song.charts.length > 1) shared += 1;
    else if (chart) only.set(chart, (only.get(chart) ?? 0) + 1);
  }

  return {
    shared,
    only: rankings.charts.map((chart) => ({ chart, count: only.get(chart) ?? 0 })),
    total: rankings.songs.length,
  };
}
