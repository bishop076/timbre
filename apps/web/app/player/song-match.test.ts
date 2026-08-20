import assert from "node:assert/strict";
import { test } from "node:test";

import { plausiblySameSong } from "./song-match.ts";
import type { Song } from "../types";

function song(title: string, artist = "", durationMs: number | null = null): Song {
  return {
    id: title,
    title,
    artists: artist ? [artist] : [],
    album: null,
    durationMs,
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

test("ordinary words shared with a stranger are not enough", () => {
  // Reported: playing Lé Real's "This Was Your Song" started a children's song. It cleared
  // the word test on *your* and *song* alone, which is exactly two hits — the threshold.
  assert.equal(
    plausiblySameSong(
      song("This Was Your Song", "Lé Real", 88_000),
      song("Wash Your Hands Song | Music for Kids", "The Singing Walrus", 200_000),
    ),
    false,
  );

  // Same report, same cause: three hits on *because*, *of* and *you*.
  assert.equal(
    plausiblySameSong(
      song("Just Because of You (feat. Henneysee)", "Lé Real", 198_000),
      song("Ne-Yo - Because Of You [Official Video]", "NeYoVEVO", 236_000),
    ),
    false,
  );
});

test("the artist's own upload still matches", () => {
  // What the fall-through exists for, and what the artist test must not break: the same
  // recording, uploaded under a title that names the artist.
  assert.equal(
    plausiblySameSong(
      song("2AM IN BOSTON", "Lé Real", 202_000),
      song("Lé Real - 2AM IN BOSTON", "Lé Real", 182_000),
    ),
    true,
  );
});

test("a label channel counts as the artist when the title credits them", () => {
  // YouTube credits a channel, not a person, so the artist is looked for in the title too.
  assert.equal(
    plausiblySameSong(
      song("As It Was", "Harry Styles"),
      song("Harry Styles - As It Was (Official Video)", "HarryStylesVEVO"),
    ),
    true,
  );
});

test("the same artist's different song is refused on length", () => {
  // Shares *love* and *song*, by the same artist, and is nowhere near the same recording.
  assert.equal(
    plausiblySameSong(
      song("Another Love Song for Nobody", "Lé Real", 159_000),
      song("Another Love Song for Everyone", "Lé Real", 380_000),
    ),
    false,
  );
});
