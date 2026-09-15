import assert from "node:assert/strict";
import { test } from "node:test";

import { GET } from "./route.ts";

type Reply = (url: URL) => Response;

async function withUpstream<T>(reply: Reply, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(reply(new URL(String(input instanceof Request ? input.url : input))))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const ask = (query: string) => GET(new Request(`http://timbre.test/api/lyrics?${query}`));

test("an LRCLIB outage is a 502, not 'this song has no lyrics'", async () => {
  const response = await withUpstream(
    () => new Response("upstream is sad", { status: 500 }),
    () => ask("title=Ghost&artist=Halsey"),
  );

  // `readAnswer` maps a 200 with a null body to `none`, which the panel states as fact. Only a
  // 502 makes it say the lookup failed.
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { lyrics: null, error: "LRCLIB did not answer." });
});

test("an LRCLIB outage on the alternatives path is a 502, not an empty list", async () => {
  const response = await withUpstream(
    () => new Response("bad gateway", { status: 502 }),
    () => ask("title=Ghost&artist=Halsey&alternatives=1"),
  );

  // A body with no `alternatives` key reads as an empty list, so a 200 here claimed to have
  // seen every alternative there is.
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "LRCLIB did not answer." });
});

test("a 404 from LRCLIB still means the track is genuinely absent", async () => {
  const response = await withUpstream(
    (url) =>
      url.pathname.endsWith("/search")
        ? Response.json([])
        : new Response("not found", { status: 404 }),
    () => ask("title=Nothing At All&artist=Nobody"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { lyrics: null });
});

test("a found track is still served", async () => {
  const response = await withUpstream(
    () =>
      Response.json({
        id: 7,
        trackName: "Ghost",
        artistName: "Halsey",
        instrumental: false,
        plainLyrics: "a line",
        syncedLyrics: "[00:01.50]a line",
      }),
    () => ask("title=Ghost&artist=Halsey"),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { lyrics: { synced: { at: number; text: string }[] } };
  assert.deepEqual(body.lyrics.synced, [{ at: 1.5, text: "a line" }]);
});

test("an automatic match reports the id of the track that answered, not the one asked for", async () => {
  const response = await withUpstream(
    () =>
      Response.json({
        id: 7,
        trackName: "Ghost",
        artistName: "Halsey",
        instrumental: false,
        plainLyrics: "a line",
        syncedLyrics: null,
      }),
    () => ask("title=Ghost&artist=Halsey"),
  );

  // Nothing named an id, so returning the query's own left `lyrics.id` undefined — and the tick
  // beside the version in use, which compares it to each alternative's id, could never be true.
  const body = (await response.json()) as { lyrics: { id: number } };
  assert.equal(body.lyrics.id, 7);
});

test("a chosen id still comes back as itself", async () => {
  const response = await withUpstream(
    (url) => {
      assert.ok(url.pathname.endsWith("/get/42"), "a chosen id is looked up directly");
      return Response.json({
        id: 42,
        trackName: "Ghost",
        artistName: "Halsey",
        instrumental: false,
        plainLyrics: "a line",
        syncedLyrics: null,
      });
    },
    () => ask("title=Ghost&artist=Halsey&id=42"),
  );

  const body = (await response.json()) as { lyrics: { id: number } };
  assert.equal(body.lyrics.id, 42);
});

test("LRCLIB's literal 'undefined' album is not an album", async () => {
  const response = await withUpstream(
    () =>
      Response.json([
        { id: 1, trackName: "Ghost", artistName: "Halsey", albumName: "undefined", instrumental: false, plainLyrics: "x", syncedLyrics: null },
        { id: 2, trackName: "Ghost", artistName: "Halsey", albumName: "   ", instrumental: false, plainLyrics: "x", syncedLyrics: null },
        { id: 3, trackName: "Ghost", artistName: "Halsey", albumName: " Badlands ", instrumental: false, plainLyrics: "x", syncedLyrics: null },
      ]),
    () => ask("title=Ghost&artist=Halsey&alternatives=1"),
  );

  // The Other-versions line joins whatever is truthy with a dot, so the word "undefined" read as
  // the album's name. Only a real name survives, and it arrives trimmed.
  const body = (await response.json()) as { alternatives: { albumName: string | null }[] };
  assert.deepEqual(
    body.alternatives.map((option) => option.albumName),
    [null, null, "Badlands"],
  );
});
