import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchGenreCharts } from "./rankings.ts";
import { DEEZER_AT_ONCE } from "./pool.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

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
