import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { interleaveByPlayability, recommendFrom, registerProvider } from "./registry.ts";
import type { Playback, SearchProvider, SourceId, SourceTrack } from "./types.ts";

function source(id: SourceId, playback: Playback): SearchProvider {
  return {
    id,
    playback,
    searchable: true,
    search: async () => [],
  };
}

function tracks(id: SourceId, count: number): SourceTrack[] {
  return Array.from({ length: count }, (_, index) => ({
    source: id,
    sourceId: `${id}-${index + 1}`,
    title: `${id} ${index + 1}`,
    artists: [],
    album: null,
    durationMs: null,
    isrc: null,
    url: null,
    artworkUrl: null,
    playback: "queue" as Playback,
  }));
}

test("sources take turns rather than one owning the top of the list", () => {
  const out = interleaveByPlayability([
    { provider: source("ytmusic", "queue"), tracks: tracks("ytmusic", 3) },
    { provider: source("audius", "queue"), tracks: tracks("audius", 3) },
  ]);

  assert.deepEqual(
    out.map((track) => track.source),
    ["ytmusic", "audius", "ytmusic", "audius", "ytmusic", "audius"],
  );
});

test("a row you can play outranks one that can only link out", () => {
  const out = interleaveByPlayability([
    { provider: source("deezer", "link"), tracks: tracks("deezer", 2) },
    { provider: source("ytmusic", "queue"), tracks: tracks("ytmusic", 2) },
  ]);

  assert.deepEqual(
    out.map((track) => track.source),
    ["ytmusic", "ytmusic", "deezer", "deezer"],
    "the whole playable tier comes first, whatever order the providers registered in",
  );
});

test("each source keeps its own relevance order", () => {
  const out = interleaveByPlayability([
    { provider: source("ytmusic", "queue"), tracks: tracks("ytmusic", 3) },
    { provider: source("audius", "queue"), tracks: tracks("audius", 3) },
  ]);

  assert.deepEqual(
    out.filter((track) => track.source === "audius").map((track) => track.sourceId),
    ["audius-1", "audius-2", "audius-3"],
  );
});

test("a short list does not leave gaps in a longer one", () => {
  const out = interleaveByPlayability([
    { provider: source("ytmusic", "queue"), tracks: tracks("ytmusic", 3) },
    { provider: source("audius", "queue"), tracks: tracks("audius", 1) },
  ]);

  assert.deepEqual(
    out.map((track) => track.sourceId),
    ["ytmusic-1", "audius-1", "ytmusic-2", "ytmusic-3"],
  );
});

test("a source that answered with nothing contributes nothing", () => {
  const out = interleaveByPlayability([
    { provider: source("ytmusic", "queue"), tracks: tracks("ytmusic", 2) },
    { provider: source("audius", "queue"), tracks: [] },
  ]);

  assert.deepEqual(out.map((track) => track.sourceId), ["ytmusic-1", "ytmusic-2"]);
});

test("a radio source that fails is reported to the caller's hook, and an abort is not", async () => {
  const failure = new Error("Deezer returned 503.");
  registerProvider({
    ...source("deezer", "link"),
    radio: async () => {
      throw failure;
    },
  });

  const limiter = new RateLimiter(new MemoryBucketStore());
  const reported: { event: string; fields: Record<string, unknown> }[] = [];
  const report = (event: string, fields: Record<string, unknown>) => reported.push({ event, fields });

  const songs = await recommendFrom({ limiter, report }, { artist: "Fred again.." }, 5);
  assert.deepEqual(songs, [], "a failed source contributes nothing and throws nothing");
  assert.deepEqual(reported, [{ event: "radio_failed", fields: { source: "deezer", error: failure } }]);

  const controller = new AbortController();
  controller.abort();
  reported.length = 0;
  await recommendFrom({ limiter, report, signal: controller.signal }, { artist: "Fred again.." }, 5);
  assert.deepEqual(reported, []);
});
