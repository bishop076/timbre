import "server-only";

import { listProviders, scoreCandidates, type RankedList } from "@timbre/providers";

import { deezer } from "./deezer";
import { bandOf } from "./rank-bands";
import { getProviderRuntime } from "./providers";

/**
 * A ranking nobody publishes.
 *
 * **The point is that it is not one service's chart.** Every catalogue's chart
 * is a measurement of its own subscribers, and Deezer's is visibly so from
 * here: the catalogue-wide artist chart is led by a German audio-drama series,
 * because that is what Deezer's German listeners were playing. Apple's feed
 * disagrees, and neither is wrong — they are counting different rooms.
 *
 * So this counts both and rewards *agreement*. A song that charts on Deezer and
 * on Apple outranks one that charts higher on a single service, which is the
 * closest thing to unbiased that free data allows: no single audience can carry
 * an entry to the top on its own.
 *
 * The fusion is `scoreCandidates` from `@timbre/providers` — Reciprocal Rank
 * Fusion with a consensus multiplier, already written and tested for the radio.
 * Reusing it rather than writing a second ranker is deliberate: two rankings
 * that disagree about what "popular" means would be a bug nobody could see.
 *
 * **What it cannot be honest about**, and says so on the page: there are two
 * charts to fuse, not twenty. Two agreeing is better than one asserting, and it
 * is still two Western streaming services. Adding a third needs a source that
 * publishes a chart without credentials, and there are not many.
 */

export interface RankedSong {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: { source: string; sourceId: string; url: string | null; playback: "link" }[];
  /** Consensus position, 1-based. */
  position: number;
  /** Which charts carried it — the evidence behind the position. */
  charts: string[];
  /** Where it sat on each chart it appeared on. */
  positions: Record<string, number>;
}

export interface Rankings {
  songs: RankedSong[];
  /** Every chart that answered, in the order they were asked. */
  charts: string[];
  /** Charts that were asked and did not answer. */
  failed: string[];
}

/** Ranks within one list, 1-based, keyed the way `mergeTracks` keys a source. */
function keyOf(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

export async function fetchRankings(limit = 100): Promise<Rankings> {
  const { limiter } = getProviderRuntime();
  const providers = listProviders().filter((provider) => provider.chart !== undefined);

  /*
   * Each chart is fetched as its own list rather than through `chartAll`, which
   * concatenates them. Fusion needs to know *where* in a list a song sat, and a
   * flat array of everyone's tracks has thrown that away.
   */
  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({
      list: provider.id,
      /*
       * Cacheable, which is what makes `/explore` a prerendered page.
       *
       * The providers default to `cache: "no-store"` because their other caller
       * is a route handler that keeps its own cache — and a single `no-store`
       * fetch anywhere in a render opts the whole route out of static
       * generation. So Explore declared `revalidate = 3600`, was quietly marked
       * **dynamic** in the build output, and re-ran every one of these upstream
       * requests on every request instead of once an hour. Nothing looked
       * broken; the page was simply built from scratch for every visitor.
       *
       * One hour, matching the route's own `revalidate`, so the two cannot
       * disagree about how old a chart may be.
       */
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

  // Where each source's own chart put each of its tracks.
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
        // Narrowed to `link`: neither charting source can be played directly,
        // so every one of these resolves a copy at play time.
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

/**
 * Which genres feed the chart, and how high their entries land.
 *
 * **This is the page's stacked column chart, and it took a wrong turn first.**
 * The obvious x-axis for a chart is chart position — but the bands are equal by
 * construction, ten songs in every ten places, so every column comes out the
 * same height and the graph says nothing. Genre is the axis where the height is
 * a real measurement: pop feeds the mainstream chart heavily, jazz barely, and
 * the difference is the finding.
 *
 * Segments are the rank band an entry landed in, which is an **ordered** scale —
 * so they take four steps of one hue rather than four different colours. A
 * rainbow across ordered bands would say the bands are unrelated kinds, when
 * 1–25 and 26–50 are neighbours on one ruler.
 *
 * Matching is exact, not fuzzy: a genre chart and the global chart both come
 * from Deezer, so the same recording carries the same id in both. No title
 * comparison, and so no chance of counting a live version as its studio twin.
 */
export interface GenreMix {
  genre: string;
  total: number;
  /** Entries per rank band, in `RANK_BANDS` order. */
  bands: number[];
}

/** One genre's chart, as recording ids. The raw material for `mixGenres`. */
export interface GenreChart {
  genre: string;
  trackIds: string[];
}

/**
 * The per-genre charts, fetched.
 *
 * **Split from the cross-referencing on purpose.** This used to be one function
 * that took the fused ranking, and so could not start until the ranking had
 * arrived — thirteen Deezer round-trips chained behind a request that needed
 * none of them. Deezer answers in one to two seconds from a cold cache, so that
 * ordering was worth several seconds of a page nobody could see yet.
 *
 * Nothing here looks at the ranking. Splitting it lets the caller start these
 * requests alongside every other one on the page and do the matching, which is
 * a map lookup over a few hundred ids, once both have landed.
 */
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
        genre: genre.name,
        trackIds: (chart?.tracks?.data ?? []).map((track) => String(track.id)),
      };
    }),
  );
}

/** Where the fused ranking's songs land across those genre charts. Pure. */
export function mixGenres(charts: GenreChart[], songs: RankedSong[]): GenreMix[] {
  // Where each Deezer recording sits in the fused ranking.
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

  // Empty genres are dropped rather than drawn as zero-height columns: a column
  // with no bar reads as a rendering failure, and a row of them buries the ones
  // that have something to say.
  return mixes.filter((mix) => mix.total > 0).sort((a, b) => b.total - a.total);
}

/**
 * How many entries each artist holds.
 *
 * The honest version of "market share": not a guess at listening hours, just a
 * count of slots on a board of a known size. An artist with four of a hundred
 * has four of a hundred, and the denominator is stated wherever it is shown.
 *
 * Credited to the first-listed artist only. Splitting a feature between two
 * names would make the shares sum past the number of songs, and a share chart
 * whose parts exceed the whole is worse than one that undercounts guests.
 */
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

/**
 * How much the charts agree with each other.
 *
 * This is the measurement the whole page rests on, so it is shown rather than
 * asserted: if almost nothing appears on both charts, the "consensus" ranking
 * is really two lists interleaved, and a reader deserves to see that.
 */
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
