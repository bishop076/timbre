import assert from "node:assert/strict";
import { test } from "node:test";

import { plausiblySameSong, sameRecording, sameTrack } from "./song-match.ts";
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
  const seed = song("I'm laughing, but I just might cry", "Jenny Macke Open Floor");

  assert.equal(plausiblySameSong(seed, song("Best Kittycat Song [OFFICIAL]", "Herr Fuchs")), false);
  assert.equal(plausiblySameSong(seed, song("Die On This Hill (NYC Visualizer)", "SIENNA SPIRO")), false);
  assert.equal(plausiblySameSong(seed, song("The Duck Song", "Bryant Oden")), false);
});

test("another upload of the same song still passes, which is the point", () => {
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
  assert.equal(plausiblySameSong(song("Redbone"), song("Redbone", "Childish Gambino")), true);
  assert.equal(plausiblySameSong(song("Redbone"), song("Alright", "Kendrick Lamar")), false);
});

test("a song with no title to compare is allowed through", () => {
  assert.equal(plausiblySameSong(song(""), song("Anything At All", "Someone")), true);
});

test("ordinary words shared with a stranger are not enough", () => {
  assert.equal(
    plausiblySameSong(
      song("This Was Your Song", "Lé Real", 88_000),
      song("Wash Your Hands Song | Music for Kids", "The Singing Walrus", 200_000),
    ),
    false,
  );

  assert.equal(
    plausiblySameSong(
      song("Just Because of You (feat. Henneysee)", "Lé Real", 198_000),
      song("Ne-Yo - Because Of You [Official Video]", "NeYoVEVO", 236_000),
    ),
    false,
  );
});

test("the artist's own upload still matches", () => {
  assert.equal(
    plausiblySameSong(
      song("2AM IN BOSTON", "Lé Real", 202_000),
      song("Lé Real - 2AM IN BOSTON", "Lé Real", 182_000),
    ),
    true,
  );
});

test("a label channel counts as the artist when the title credits them", () => {
  assert.equal(
    plausiblySameSong(
      song("As It Was", "Harry Styles"),
      song("Harry Styles - As It Was (Official Video)", "HarryStylesVEVO"),
    ),
    true,
  );
});

test("the same artist's different song is refused on length", () => {
  assert.equal(
    plausiblySameSong(
      song("Another Love Song for Nobody", "Lé Real", 159_000),
      song("Another Love Song for Everyone", "Lé Real", 380_000),
    ),
    false,
  );
});

test("another version of the song is not a copy of it", () => {
  const seed = song("Love Quizzes", "rhyu", 212_142);

  assert.equal(plausiblySameSong(seed, song("love quizzes rhyu instrumental", "test", 213_000)), false);
  assert.equal(
    plausiblySameSong(seed, song("Tara Turton sings “Love Quizzes” by rhyu", "Tara Turton", 212_000)),
    false,
  );
  assert.equal(plausiblySameSong(seed, song("Rhyu love quizzes speed up semitones.m4a", "love love")), false);
  assert.equal(plausiblySameSong(song("Wonderwall (Live)", "Oasis"), song("Wonderwall - Live", "Oasis")), true);
});

test("a stranger's upload must run as long as the song, since it may be a different take", () => {
  const seed = song("Love Quizzes", "rhyu", 212_142);

  assert.equal(
    plausiblySameSong(seed, song("Love Quizzes - RAINE (rhyu) [4K]", "Mic's Video Station", 260_000)),
    false,
  );
  assert.equal(plausiblySameSong(seed, song("rhyu - Love Quizzes", "someone", 214_000)), true);
});

test("a decorated title and its plain one are one recording, either way round", () => {
  const upload = song("Pandemonium (Visualizer Video)", "NIKI");
  const plain = song("Pandemonium", "NIKI");

  assert.equal(sameRecording(plain, upload), true);
  assert.equal(sameRecording(upload, plain), true);
});

test("two songs sharing only their decoration are not the same recording", () => {
  const a = song("Strange Land (Acoustic Version)", "NIKI");
  const b = song("La La Lost You (Acoustic Version)", "NIKI");

  assert.equal(plausiblySameSong(a, b), true);
  assert.equal(sameRecording(a, b), false);
});

test("one artist's two songs are kept apart, and two artists' one title is too", () => {
  assert.equal(sameRecording(song("lowkey", "NIKI"), song("La La Lost You", "NIKI")), false);
  assert.equal(
    sameRecording(
      { ...song("Take Care", "NIKI"), id: "niki-take-care" },
      { ...song("Take Care", "Drake"), id: "drake-take-care" },
    ),
    false,
  );
});

test("a guest credit named on only one side still matches", () => {
  assert.equal(
    sameRecording(song("Plans (feat. Vory)", "88rising"), song("Plans", "88rising")),
    true,
  );
});

test("the same entry twice is caught on its id without parsing anything", () => {
  const a = song("Anything At All", "Someone");
  assert.equal(sameRecording(a, { ...a, title: "totally different" }), true);
});

test("the same recording under two ids is one queue entry", () => {
  const first = { ...song("Levitating", "Dua Lipa"), id: "levitating||dua lipa#ytmusic:aaa" };
  const second = { ...song("Levitating", "Dua Lipa"), id: "levitating||dua lipa#ytmusic:bbb" };

  assert.equal(sameTrack(first, second), true);
});

test("a feature credited one way and not the other is still one queue entry", () => {
  assert.equal(sameTrack(song("Sunflower (feat. Swae Lee)", "Post Malone"), song("Sunflower", "Post Malone")), true);
});

test("two different songs sharing a title are not one queue entry", () => {
  const niki = { ...song("Take Care", "NIKI"), id: "take care||niki#ytmusic:aaa" };
  const drake = { ...song("Take Care", "Drake"), id: "take care||drake#ytmusic:bbb" };

  assert.equal(sameTrack(niki, drake), false);
});

test("a variant is a queue entry of its own, unlike a suggestion", () => {
  const studio = song("Wonderwall", "Oasis");
  const live = song("Wonderwall (Live)", "Oasis");

  assert.equal(sameTrack(studio, live), false);
  assert.equal(sameRecording(studio, live), true);
});

test("distinct ISRCs settle it even when the names agree", () => {
  const a = { ...song("Wonderwall", "Oasis"), id: "one", isrc: "GBAAA0000001" };
  const b = { ...song("Wonderwall", "Oasis"), id: "two", isrc: "GBAAA0000002" };

  assert.equal(sameTrack(a, b), false);
});
