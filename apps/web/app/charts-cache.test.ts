import assert from "node:assert/strict";
import { test } from "node:test";

let instance = 0;

async function fresh(seed?: Record<string, string>) {
  const backing: Record<string, string> = { ...seed };

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
        backing[key] = value;
      },
    },
  };

  instance += 1;
  const cache = await import(`./charts-cache.ts?instance=${instance}`);
  return { cache, backing };
}

const KEY = "timbre:charts";

function song(id: string) {
  return {
    id,
    title: `Track ${id}`,
    artists: ["Bicep"],
    album: null,
    durationMs: 1000,
    isrc: null,
    artworkUrl: null,
    sources: [],
  };
}

test("a malformed cached row is dropped on read rather than handed to a shelf", async () => {
  const { cache } = await fresh({
    [KEY]: JSON.stringify({ songs: [null, {}, { id: "x" }, "a string", song("a")] }),
  });

  assert.deepEqual(cache.readCachedCharts(), { songs: [song("a")], failures: [] });
});

test("a cache that is not even the right shape reads as a first visit", async () => {
  for (const raw of ["null", "[]", '{"songs":{}}', "not json"]) {
    const { cache } = await fresh({ [KEY]: raw });
    assert.equal(cache.readCachedCharts(), null, raw);
  }
});

test("rememberCharts never writes a row that would not survive the read", async () => {
  const { cache, backing } = await fresh();

  cache.rememberCharts({ songs: [null, {}, { id: "x" }, song("a")], failures: [] } as never);

  const written = JSON.parse(backing[KEY]!) as { songs: unknown[] };
  assert.deepEqual(written.songs, [song("a")]);
  assert.deepEqual(cache.readCachedCharts()?.songs, [song("a")]);
});
