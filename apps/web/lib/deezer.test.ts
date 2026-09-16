import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { z } from "zod";

import {
  deezer,
  deezerList,
  deezerListOrFail,
  deezerOrFail,
  DeezerUnavailable,
  fetchChartTracks,
} from "./deezer.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function answering(body: unknown, init: ResponseInit = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    })) as typeof fetch;
}

function failing(cause: unknown) {
  globalThis.fetch = (async () => {
    throw cause;
  }) as typeof fetch;
}

// The shapes are the ones api.deezer.com actually returns: it answers 200 to everything and
// puts the verdict in the body.
const NO_DATA = { error: { type: "DataException", message: "no data", code: 800 } };
const BAD_PATH = { error: { type: "InvalidQueryException", message: "Unknown path", code: 600 } };
const QUOTA = { error: { type: "Exception", message: "Quota limit exceeded", code: 4 } };
const BUSY = { error: { type: "Exception", message: "Service busy", code: 700 } };

test("a real answer comes back whole", async () => {
  answering({ id: 13, name: "Eminem" });
  assert.deepEqual(await deezerOrFail("/artist/13"), { id: 13, name: "Eminem" });
});

test("'no data' is an absence, not a failure", async () => {
  answering(NO_DATA);
  assert.equal(await deezerOrFail("/artist/99999999999"), null);
});

test("a deterministic error is an absence too — retrying cannot change it", async () => {
  answering(BAD_PATH);
  assert.equal(await deezerOrFail("/nosuchendpoint"), null);
});

const failures: [string, () => void][] = [
  ["a timeout", () => failing(new DOMException("The operation timed out.", "TimeoutError"))],
  ["an unreachable host", () => failing(new TypeError("fetch failed"))],
  ["a 5xx from the edge", () => answering({}, { status: 503 })],
  ["a body that is not JSON", () => {
    globalThis.fetch = (async () => new Response("<html>maintenance</html>", { status: 200 })) as typeof fetch;
  }],
  ["being rate limited", () => answering(QUOTA)],
  ["Deezer calling itself busy", () => answering(BUSY)],
];

for (const [name, arrange] of failures) {
  test(`${name} throws rather than reading as an absence`, async () => {
    arrange();
    await assert.rejects(() => deezerOrFail("/album/1"), DeezerUnavailable);
  });

  test(`${name} still reads as an absence through the forgiving deezer()`, async () => {
    arrange();
    assert.equal(await deezer("/album/1"), null);
  });
}

// Nothing in this suite read the request, so the one header that keeps Deezer answering in
// English could have been deleted without a single test noticing. It is the whole of the fix
// for the deployment that rendered "Fresh in ダンス" and billed Tame Impala as テーム・インパラ,
// and the merge keys on the artist name, so losing it costs more than cosmetics.
test("every read pins the language, whatever the exit IP geolocates to", async () => {
  const seen: (Headers | undefined)[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await deezerOrFail("/chart/0?limit=2");
  await deezer("/search/playlist?q=sleep&limit=10");

  assert.equal(seen.length, 2);
  for (const headers of seen) assert.equal(headers?.get("accept-language"), "en-US,en;q=0.9");
});

// `deezerRows` and the two readers over it. Every list read in `lib/` used to be an `interface`
// and a cast, so a row Deezer sent that is not the row the interface described reached the
// mapper untouched: `null` in a chart threw `Cannot read properties of null (reading 'id')`, and
// a `data` that is an object rather than a list threw `list is not iterable` before any row was
// read at all. Both were 500s and broken pages out of requests that were perfectly well formed.
const row = z.object({ id: z.number(), title: z.string() });

test("a row Deezer garbled is dropped; the rows around it still arrive", async () => {
  answering({ data: [{ id: 1, title: "Kid A" }, null, { id: 2 }, "nope", { id: 3, title: "Amnesiac" }] });

  assert.deepEqual(await deezerList("/artist/399/albums", row), [
    { id: 1, title: "Kid A" },
    { id: 3, title: "Amnesiac" },
  ]);
  assert.deepEqual(await deezerListOrFail("/artist/399/albums", row), [
    { id: 1, title: "Kid A" },
    { id: 3, title: "Amnesiac" },
  ]);
});

test("a body that is not a list is an empty shelf to one reader and a failure to the other", async () => {
  for (const body of [{ data: { nope: true } }, { data: "not a list" }, {}, [], "text"]) {
    answering(body);
    assert.deepEqual(await deezerList("/radio/genres", row), [], JSON.stringify(body));
    await assert.rejects(
      () => deezerListOrFail("/genre", row),
      DeezerUnavailable,
      JSON.stringify(body),
    );
  }
});

// `deezerOrFail` answers null when Deezer said there is no such thing, and that is an absence
// rather than a body this could not read — the strict reader must not turn it into a failure.
test("'no data' is still an absence through the strict list read", async () => {
  answering(NO_DATA);
  assert.deepEqual(await deezerListOrFail("/artist/99999999999/albums", row), []);
});

test("a chart whose track rows are junk is the tracks that are not", async () => {
  answering({ tracks: { data: [null, { id: 7, title: "Idioteque" }] } });
  assert.deepEqual(
    (await fetchChartTracks(0)).map((track) => track.title),
    ["Idioteque"],
  );

  answering({ tracks: { data: "not a list" } });
  assert.deepEqual(await fetchChartTracks(0), []);
});
