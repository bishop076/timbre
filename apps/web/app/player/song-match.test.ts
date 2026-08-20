import assert from "node:assert/strict";
import { test } from "node:test";

import { plausiblySameSong } from "./song-match.ts";
import type { Song } from "../types";

function song(title: string, artist = ""): Song {
  return {
    id: title,
    title,
    artists: artist ? [artist] : [],
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: null,
    sources: [],
  };
}

test("a search result that shares nothing with the song is refused", () => {
  // The reported failure: a Mixcloud show would not play, its title went to YouTube Music,
  // and the top result was played as though it were the song.
  const seed = song("I'm laughing, but I just might cry", "Jenny Macke Open Floor");

  assert.equal(plausiblySameSong(seed, song("Best Kittycat Song [OFFICIAL]", "Herr Fuchs")), false);
  assert.equal(plausiblySameSong(seed, song("Die On This Hill (NYC Visualizer)", "SIENNA SPIRO")), false);
  assert.equal(plausiblySameSong(seed, song("The Duck Song", "Bryant Oden")), false);
});

test("another upload of the same song still passes, which is the point", () => {
  // Rejecting these would break the fall-through this guard exists to serve — every one is
  // the same recording under a different upload's title.
  assert.equal(plausiblySameSong(song("Wonderwall"), song("Wonderwall - Remastered", "Oasis")), true);
  assert.equal(
    plausiblySameSong(song("As It Was (Official Video)"), song("As It Was", "Harry Styles")),
    true,
  );
  assert.equal(
    plausiblySameSong(song("Blinding Lights"), song("Blinding Lights (Official Video)", "The Weeknd")),
    true,
  );
});

test("a one-word title needs the word, not two of them", () => {
  // `Math.max(2, …)` would refuse every single-word title without the `hits === wanted.length`
  // arm — and single-word titles are ordinary.
  assert.equal(plausiblySameSong(song("Redbone"), song("Redbone", "Childish Gambino")), true);
  assert.equal(plausiblySameSong(song("Redbone"), song("Alright", "Kendrick Lamar")), false);
});

test("a song with no title to compare is allowed through", () => {
  // Refusing here would make an empty title unplayable rather than merely unverifiable.
  assert.equal(plausiblySameSong(song(""), song("Anything At All", "Someone")), true);
});
