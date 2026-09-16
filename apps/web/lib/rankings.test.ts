import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchGenreCharts, mixGenres } from "./rankings.ts";
import type { FeedProbe } from "./genre-feed.ts";
import { DEEZER_AT_ONCE } from "./pool.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** Deezer answers 200 to everything and puts the verdict in the body; 4 is its quota refusal. */
const QUOTA_REFUSAL = { error: { code: 4, message: "Quota limit exceeded" } };

const GENRES = [
  { id: 132, name: "Pop" },
  { id: 116, name: "Rap/Hip Hop" },
  { id: 152, name: "Rock" },
];

async function withDeezer<T>(reply: (url: URL) => unknown, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    assert.equal(url.origin, "https://api.deezer.com", "the suite must never leave the machine");
    return Promise.resolve(Response.json(reply(url)));
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const chartOf = (genre: number) => ({
  tracks: { data: [{ id: genre * 10, title: `Number one in ${genre}` }] },
});

// A genre whose chart was refused reads as a genre no charting song belongs to: it drops out of
// the genre mix and off every song's chips, identically to a genre that charted nothing. That is
// what `/explore` then baked for an hour under a year of `stale-while-revalidate` — measured on a
// production build as `s-maxage=3600, stale-while-revalidate=31532400`, `x-nextjs-cache: HIT`.
// The probe is what lets `app/explore/page.tsx` tell the two apart and refuse to be remembered.
test("a genre chart Deezer refused is reported, not forgiven into an empty chart", async () => {
  const probe: FeedProbe = { failed: false };
  const charts = await withDeezer(
    (url) =>
      url.pathname === "/genre"
        ? { data: GENRES }
        : url.pathname === "/chart/132"
          ? QUOTA_REFUSAL
          : chartOf(Number(url.pathname.split("/")[2])),
    () => fetchGenreCharts(30, probe),
  );

  assert.equal(probe.failed, true);

  // The shape the caller gets is unchanged — the best that could be had is still served.
  assert.deepEqual(charts.find((chart) => chart.id === 132), {
    id: 132,
    genre: "Pop",
    trackIds: [],
  });
  assert.equal(mixGenres(charts, []).length, 0);
});

test("a genre that simply charted nothing does not trip the probe", async () => {
  const probe: FeedProbe = { failed: false };
  await withDeezer(
    (url) =>
      url.pathname === "/genre"
        ? { data: GENRES }
        : url.pathname === "/chart/132"
          ? { tracks: { data: [] } }
          : chartOf(Number(url.pathname.split("/")[2])),
    () => fetchGenreCharts(30, probe),
  );

  assert.equal(probe.failed, false, "an empty chart is an answer, and the page may cache it");
});

test("thirty genre charts do not all go on the wire at once", async () => {
  const genres = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `G${index}` }));
  let live = 0;
  let peak = 0;

  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    assert.equal(url.origin, "https://api.deezer.com", "the suite must never leave the machine");
    if (url.pathname === "/genre") return Response.json({ data: genres });

    live += 1;
    peak = Math.max(peak, live);
    await tick();
    live -= 1;
    return Response.json({ tracks: { data: [{ id: 1, title: "x" }] } });
  }) as typeof fetch;

  try {
    const charts = await fetchGenreCharts(30);

    // Deezer's bucket holds 20. Thirty at once is how a genre's chart comes back refused,
    // reads as "no charting song is in this genre", and stays that way for an hour of ISR.
    assert.equal(peak, DEEZER_AT_ONCE);
    assert.equal(charts.length, 30);
    assert.deepEqual(
      charts.map((chart) => chart.id),
      genres.map((genre) => genre.id),
      "queueing must not reorder them",
    );
  } finally {
    globalThis.fetch = original;
  }
});
