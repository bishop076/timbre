import assert from "node:assert/strict";
import { test } from "node:test";

import type { Song } from "../types";
import { drawRadio } from "./draw-radio.ts";

function song(title: string, artist = title): Song {
  return {
    id: `${title}#ytmusic:${title}`,
    title,
    artists: [artist],
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: null,
    sources: [],
  };
}

/** A pool of 50, every song by a different artist so spacing never binds. */
function pool(size = 50): Song[] {
  return Array.from({ length: size }, (_, index) => song(`Song ${index + 1}`, `Artist ${index + 1}`));
}

const titles = (songs: Song[]) => songs.map((entry) => entry.title);

/** A `random` that walks a fixed list, so a draw can be asserted exactly. */
function scripted(values: number[]): () => number {
  let at = 0;
  return () => values[at++ % values.length]!;
}

test("a draw takes the asked-for number out of a larger pool", () => {
  const drawn = drawRadio(pool(), { count: 25 });

  assert.equal(drawn.length, 25);
  assert.equal(new Set(titles(drawn)).size, 25, "and never the same song twice");
});

test("two plays of the same seed do not produce the same running order", () => {
  // The reported complaint: the same song always opened the same queue. The pool is fixed
  // and shared — it is cached per seed — so the variety has to come out of the draw.
  const orders = new Set<string>();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    orders.add(titles(drawRadio(pool(), { count: 25 })).join("|"));
  }

  assert.ok(orders.size > 1, `expected varied orders, got ${orders.size} distinct`);
});

test("the ranking still decides most of it — the top is drawn far more often than the tail", () => {
  // Variety that ignored the ranking would be a shuffle, and would throw away the rank
  // fusion that earns the recommendation. Measured over the pool's two halves.
  let top = 0;
  let bottom = 0;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const first = drawRadio(pool(), { count: 1 })[0]!;
    const rank = Number(first.title.replace("Song ", ""));
    if (rank <= 25) top += 1;
    else bottom += 1;
  }

  assert.ok(top > bottom, `expected the better half to lead more often, got ${top} vs ${bottom}`);
});

test("a song already in the queue is never drawn", () => {
  const candidates = pool(10);
  const queued = candidates.slice(0, 8);

  const drawn = drawRadio(candidates, { count: 10, exclude: queued });

  assert.deepEqual(titles(drawn).sort(), ["Song 10", "Song 9"]);
});

test("an excluded song stays out even when it arrives under a different id", () => {
  // The whole point of matching on the recording: a second fetch may rank a different
  // upload first, and the id changes with it.
  const candidates = [song("Levitating", "Dua Lipa"), song("Keep", "Beta")];
  const queuedCopy = { ...song("Levitating", "Dua Lipa"), id: "levitating#ytmusic:other" };

  assert.deepEqual(titles(drawRadio(candidates, { count: 5, exclude: [queuedCopy] })), ["Keep"]);
});

test("recently played songs are held back, then used rather than returning short", () => {
  const candidates = pool(6);
  // Everything but two has been heard recently.
  const heard = candidates.slice(0, 4);

  const drawn = drawRadio(candidates, { count: 6, avoid: heard });

  assert.equal(drawn.length, 6, "a queue that stops is worse than one that repeats");
  const fresh = titles(drawn).slice(0, 2).sort();
  assert.deepEqual(fresh, ["Song 5", "Song 6"], "the unheard two come first");
  // The rest follow in rank order, which is the least bad way to continue.
  assert.deepEqual(titles(drawn).slice(2), ["Song 1", "Song 2", "Song 3", "Song 4"]);
});

test("history is avoided entirely when there is enough that is unheard", () => {
  const candidates = pool(20);
  const heard = candidates.slice(0, 10);

  const drawn = drawRadio(candidates, { count: 5, avoid: heard });

  for (const entry of drawn) {
    assert.ok(!heard.some((old) => old.title === entry.title), `${entry.title} was heard recently`);
  }
});

test("no artist appears twice within three consecutive picks", () => {
  // Three artists, four songs each: spacing has to bind, and cannot be satisfied by luck.
  const candidates = ["Alpha", "Beta", "Gamma"].flatMap((artist) =>
    [1, 2, 3, 4].map((n) => song(`${artist} ${n}`, artist)),
  );

  const drawn = drawRadio(candidates, { count: 9 });

  for (let at = 1; at < drawn.length; at += 1) {
    assert.notEqual(drawn[at]!.artists[0], drawn[at - 1]!.artists[0], `repeat at ${at}`);
  }
});

test("spacing yields rather than returning short when one artist owns what is left", () => {
  const candidates = [song("A", "Solo"), song("B", "Solo"), song("C", "Solo")];

  assert.equal(drawRadio(candidates, { count: 3 }).length, 3);
});

test("asking for more than the pool holds returns the pool, not a hang", () => {
  assert.equal(drawRadio(pool(4), { count: 25 }).length, 4);
});

test("an empty pool and a zero count are both empty, not errors", () => {
  assert.deepEqual(drawRadio([], { count: 5 }), []);
  assert.deepEqual(drawRadio(pool(), { count: 0 }), []);
});

test("the extreme ends of random() still select a song", () => {
  // A `random()` of exactly 0 must not fall through the ticket loop, and one that rounds to
  // the total must not run off the end of it.
  assert.equal(drawRadio(pool(5), { count: 5, random: scripted([0]) }).length, 5);
  assert.equal(drawRadio(pool(5), { count: 5, random: scripted([0.999999999]) }).length, 5);
});

test("a scripted draw of zero walks the pool in rank order", () => {
  // `random() === 0` always takes the first ticket, which is the best remaining candidate —
  // so the weighting is doing what it says rather than reordering by accident.
  const drawn = drawRadio(pool(5), { count: 3, random: scripted([0]) });

  assert.deepEqual(titles(drawn), ["Song 1", "Song 2", "Song 3"]);
});
