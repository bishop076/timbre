import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeTracks } from "./merge.ts";
import type { SourceId, SourceTrack } from "./types.ts";

function track(overrides: Partial<SourceTrack> & { source: SourceId }): SourceTrack {
  return {
    sourceId: `${overrides.source}-1`,
    title: "Wonderwall",
    artists: ["Oasis"],
    album: null,
    durationMs: 259_000,
    isrc: null,
    url: null,
    artworkUrl: null,
    playback: overrides.source === "ytmusic" ? "queue" : "link",
    ...overrides,
  };
}

const sourcesOf = (song: { sources: SourceTrack[] }) => song.sources.map((source) => source.source);

const counts: [string, SourceTrack[], number][] = [
  ["an empty result set produces no songs", [], 0],
  [
    "different ISRCs never merge, however alike they look",
    [
      track({ source: "deezer", isrc: "GBAAW9500189", sourceId: "a" }),
      track({ source: "apple", isrc: "GBQCP2500095", sourceId: "b" }),
    ],
    2,
  ],
  [
    "a live take never merges into the studio version",
    [
      track({ source: "ytmusic" }),
      track({ source: "deezer", title: "Wonderwall (Live at Knebworth)" }),
    ],
    2,
  ],
  [
    "an acoustic version never merges into the original, whatever the brackets",
    [
      track({ source: "ytmusic" }),
      track({ source: "deezer", title: "Wonderwall (Acoustic)" }),
      track({ source: "apple", title: "Wonderwall - Acoustic Version" }),
    ],
    2,
  ],
  [
    "durations that disagree keep recordings apart",
    [track({ source: "ytmusic" }), track({ source: "deezer", durationMs: 320_000 })],
    2,
  ],
  [
    "a small duration difference is tolerated",
    [track({ source: "ytmusic" }), track({ source: "deezer", durationMs: 261_000 })],
    1,
  ],
  [
    "an unknown duration is not treated as a mismatch",
    [track({ source: "ytmusic" }), track({ source: "apple", durationMs: null })],
    1,
  ],
  [
    "a variant never merges into the original, even with no ISRC anywhere",
    [
      track({ source: "ytmusic", title: "Blinding Lights", durationMs: 200_000 }),
      track({ source: "audius", title: "Blinding Lights (Zaza Remix)", durationMs: 200_000 }),
    ],
    2,
  ],
  [
    "a different edit still stands apart, however the credits are written",
    [
      track({ source: "deezer", title: "This Was Your Song", artists: ["Lé Real"], durationMs: 93_000 }),
      track({
        source: "apple",
        title: "This Was Your Song",
        artists: ["Lé Real & Jordan Maxwell"],
        durationMs: 88_050,
      }),
    ],
    2,
  ],
  [
    "a track crediting nobody does not swallow every song of the same name",
    [
      track({ source: "ytmusic", title: "Halo", artists: [] }),
      track({ source: "deezer", title: "Halo", artists: ["Beyoncé"] }),
    ],
    2,
  ],
  [
    "a live take stays apart even when one side also names the guest",
    [
      track({ source: "deezer" }),
      track({ source: "apple", title: "Wonderwall (Live)", artists: ["Oasis & Noel Gallagher"] }),
    ],
    2,
  ],
];

for (const [name, input, expected] of counts) {
  test(name, () => assert.equal(mergeTracks(input).length, expected));
}

test("an uploader's byline does not keep a copy out of the song it belongs to", () => {
  // SoundCloud and Audius write the artist into the title, in either order; the catalogues do
  // not. Filing that byline as a variant split one recording into three rows, each holding one
  // source, so a song with a playable copy could present as one without.
  const songs = mergeTracks([
    track({ source: "soundcloud", title: "Björk - Jóga", artists: ["Björk"], sourceId: "sc" }),
    track({ source: "audius", title: "Jóga - Björk", artists: ["Björk"], sourceId: "au" }),
    track({ source: "deezer", title: "Jóga", artists: ["Björk"], sourceId: "dz" }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(sourcesOf(songs[0]!), ["soundcloud", "audius", "deezer"]);
});

test("a dash that is not the credited artist still keeps two recordings apart", () => {
  const songs = mergeTracks([
    track({ source: "soundcloud", title: "Jóga - Björk", artists: ["Some Uploader"] }),
    track({ source: "deezer", title: "Jóga", artists: ["Björk"] }),
  ]);
  assert.equal(songs.length, 2, "an uncredited name is evidence about the recording");
});

test("merges the same recording across sources, the playable one leading", () => {
  const songs = mergeTracks([
    track({ source: "apple" }),
    track({ source: "ytmusic" }),
    track({ source: "deezer" }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(sourcesOf(songs[0]!), ["ytmusic", "apple", "deezer"]);
  assert.equal(songs[0]!.sources[0]!.playback, "queue");
});

test("an ISRC match is decisive even when the titles differ", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", isrc: "GBAAW9500189" }),
    track({ source: "deezer", isrc: "GBAAW9500189", title: "Wonderwall - Remastered" }),
  ]);
  assert.equal(songs.length, 1);
  assert.equal(songs[0]!.isrc, "GBAAW9500189");
});

test("one source contributes at most once per song", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "first" }),
    track({ source: "ytmusic", sourceId: "second" }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(songs[0]!.sources.map((source) => source.sourceId), ["first"]);
});

test("song ids are unique even when two recordings share a dedupe key", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "a" }),
    track({ source: "ytmusic", sourceId: "b", durationMs: 400_000 }),
  ]);
  assert.equal(songs.length, 2);
  assert.notEqual(songs[0]!.id, songs[1]!.id);
});

test("a blank ISRC is not an id, and cannot collide", () => {
  const songs = mergeTracks(
    ["One", "Two", "Three"].map((title) =>
      track({ source: "audius", sourceId: title, title, isrc: "" }),
    ),
  );
  assert.equal(new Set(songs.map((song) => song.id)).size, 3);
  for (const song of songs) assert.ok(song.id.length > 0, "an id must never be empty");
});

test("display metadata is filled in from whichever source has it", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic" }),
    track({ source: "deezer", album: "Morning Glory", artworkUrl: "https://art.example/x.jpg" }),
  ]);
  assert.equal(songs.length, 1);
  assert.equal(songs[0]!.album, "Morning Glory");
  assert.equal(songs[0]!.artworkUrl, "https://art.example/x.jpg");
});

test("input order is preserved so the primary source drives relevance", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", title: "Second Song", sourceId: "s2" }),
    track({ source: "ytmusic", title: "First Song", sourceId: "s1" }),
  ]);
  assert.deepEqual(
    songs.map((song) => song.title),
    ["Second Song", "First Song"],
  );
});

test("one catalogue naming the guest does not split the recording in two", () => {
  const songs = mergeTracks([
    track({
      source: "deezer",
      title: "This Was Your Song",
      artists: ["Lé Real"],
      durationMs: 93_000,
      isrc: "QM42K1730629",
    }),
    track({
      source: "apple",
      title: "This Was Your Song",
      artists: ["Lé Real & Jordan Maxwell"],
      durationMs: 92_004,
    }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(sourcesOf(songs[0]!), ["deezer", "apple"]);
});

test("a preview clip survives the merge on the source that offered it", () => {
  const preview = "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3";
  const songs = mergeTracks([
    track({ source: "ytmusic", previewUrl: null }),
    track({ source: "deezer", previewUrl: preview }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(
    songs[0]!.sources.map((source) => source.previewUrl),
    [null, preview],
  );
});

test("a track carrying an ISRC joins the group that holds it, not the first title match", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "yt-long", durationMs: 189_000 }),
    track({ source: "ytmusic", sourceId: "yt-short", durationMs: 174_000 }),
    track({ source: "deezer", durationMs: 174_000, isrc: "GBK3W2000225" }),
    track({ source: "soundcloud", durationMs: 189_000, isrc: "GBK3W2000225" }),
  ]);
  assert.equal(songs.length, 2);
  assert.equal(new Set(songs.map((song) => song.id)).size, 2, "two songs must not share an id");
  const owner = songs.find((song) => song.isrc === "GBK3W2000225")!;
  assert.deepEqual(sourcesOf(owner).sort(), ["deezer", "soundcloud", "ytmusic"]);
});

test("an ISRC spelled differently by two sources is still one song", () => {
  const [song, ...rest] = mergeTracks([
    track({ source: "deezer", isrc: "GBAAW9500189" }),
    track({ source: "soundcloud", isrc: "gb-aaw-95-00189", title: "Bittersweet Symphony " }),
  ]);

  assert.equal(rest.length, 0, "hyphens and case are spelling, not identity");
  assert.deepEqual(
    song!.sources.map((entry) => entry.source).sort(),
    ["deezer", "soundcloud"],
  );
  assert.equal(song!.isrc, "GBAAW9500189", "the canonical form is what the song carries");
  assert.equal(song!.id, "GBAAW9500189");
});

test("a free-text isrc field that is not an ISRC decides nothing", () => {
  const songs = mergeTracks([
    track({ source: "audius", isrc: "none", title: "One" }),
    track({ source: "deezer", isrc: "n/a", title: "Two" }),
  ]);

  // Two unrelated songs, each with junk where an ISRC should be. Trusting it byte-for-byte
  // would have merged them on "not an ISRC" — and made it the id of whichever won.
  assert.equal(songs.length, 2);
  assert.deepEqual(
    songs.map((entry) => entry.isrc),
    [null, null],
  );
});

// The catalogues do not agree about how long a recording is. Deezer reports whole seconds, Apple
// milliseconds, and the two are measuring masters cut years apart: over 4,906 tracks from both,
// the same studio take differs by up to 5.6 seconds. Every pair below is one recording, and the
// three-second guard filed each of them as two rows, each holding one source.
const rejoined: [string, SourceTrack[]][] = [
  [
    "one album track, five and a half seconds apart in two catalogues, is one song",
    [
      track({ source: "apple", title: "The Boxer", artists: ["Simon & Garfunkel"], album: "Bridge Over Troubled Water", durationMs: 312_578 }),
      track({ source: "deezer", title: "The Boxer", artists: ["Simon & Garfunkel"], album: "Bridge Over Troubled Water", durationMs: 307_000, isrc: "USSM17000075" }),
    ],
  ],
  [
    "the same recording on the album and on the best-of is still one song",
    [
      track({ source: "apple", title: "Bleecker Street", artists: ["Simon & Garfunkel"], album: "Wednesday Morning, 3 A.M.", durationMs: 167_894 }),
      track({ source: "deezer", title: "Bleecker Street", artists: ["Simon & Garfunkel"], album: "The Essential Simon & Garfunkel", durationMs: 163_000 }),
    ],
  ],
  [
    "one catalogue spelling the remaster into the title does not make a second recording",
    [
      track({ source: "apple", title: "Changes", artists: ["David Bowie"], album: "Hunky Dory (2015 Remaster)", durationMs: 217_152 }),
      track({ source: "deezer", title: "Changes (2015 Remaster)", artists: ["David Bowie"], album: "Hunky Dory (2015 Remaster)", durationMs: 212_000 }),
    ],
  ],
  [
    "a guest named by one catalogue and not the other does not split the album track",
    [
      track({ source: "apple", title: "Over", artists: ["Portishead", "Nick Ingman & Orchestra"], album: "Portishead", durationMs: 235_533 }),
      track({ source: "deezer", title: "Over", artists: ["Portishead"], album: "Portishead", durationMs: 240_000 }),
    ],
  ],
];

for (const [name, input] of rejoined) {
  test(name, () => {
    const songs = mergeTracks(input);
    assert.equal(songs.length, 1, name);
    assert.equal(songs[0]!.sources.length, 2);
  });
}

// The other half of the same trade. Nothing here may merge, and the wider window is what would
// have let it: each pair agrees on the normalised title, the version tags and the credits, and
// the only thing holding it apart is that the duration disagrees by more than three seconds.
const keptApart: [string, SourceTrack[]][] = [
  [
    "a remaster on another album is not corroborated by the album, and stays apart",
    [
      track({ source: "apple", title: "Everywhere", artists: ["Fleetwood Mac"], album: "Greatest Hits", durationMs: 222_733 }),
      track({ source: "deezer", title: "Everywhere (2017 Remaster)", artists: ["Fleetwood Mac"], album: "Tango in the Night (2017 Remaster) [Deluxe Edition]", durationMs: 226_667 }),
    ],
  ],
  [
    "two remixes off one EP agree on everything the grouping compares, and still do not merge",
    // Both reduce to `marvin gaye` + `remix`, and they share an album, so only the titles
    // themselves say these are two records. The gap is put inside the widened window on purpose;
    // on the shelf these two are seventeen seconds apart.
    [
      track({ source: "apple", title: "Marvin Gaye (feat. Meghan Trainor) [Boehm Remix]", artists: ["Charlie Puth"], album: "Marvin Gaye (feat. Meghan Trainor) [Remixes] - EP", durationMs: 194_500 }),
      track({ source: "deezer", title: "Marvin Gaye (feat. Meghan Trainor) [Cahill Remix]", artists: ["Charlie Puth"], album: "Marvin Gaye (feat. Meghan Trainor) [Remixes] - EP", durationMs: 189_500 }),
    ],
  ],
  [
    "a radio edit is minutes short of the album cut, and nothing corroborates it back together",
    [
      track({ source: "apple", title: "Layla", artists: ["Derek & The Dominos"], album: "Layla and Other Assorted Love Songs", durationMs: 425_000 }),
      track({ source: "deezer", title: "Layla (Radio Edit)", artists: ["Derek & The Dominos"], album: "Layla and Other Assorted Love Songs", durationMs: 178_000 }),
    ],
  ],
  [
    "a music video with an intro carries no album and its own title, so nothing widens the window",
    [
      track({ source: "apple", title: "Thriller", artists: ["Michael Jackson"], album: "Thriller", durationMs: 357_000 }),
      track({ source: "ytmusic", title: "Michael Jackson - Thriller (Official Video)", artists: ["Michael Jackson"], album: null, durationMs: 363_000 }),
    ],
  ],
  [
    "two takes of one song on one album are two songs, however alike the sleeve makes them look",
    // `Planet Waves` closes with a second, slower reading of the opener. Same title, same credits,
    // same album: the widened window is what keeps them apart, by being a window and not a door.
    [
      track({ source: "apple", title: "Forever Young", artists: ["Bob Dylan"], album: "Planet Waves", durationMs: 297_103 }),
      track({ source: "deezer", title: "Forever Young", artists: ["Bob Dylan"], album: "Planet Waves", durationMs: 168_216, isrc: "USSM17300253" }),
    ],
  ],
  [
    "five seconds apart, one title, two singers is two recordings",
    [
      track({ source: "apple", title: "Hallelujah", artists: ["Jeff Buckley"], album: "Grace", durationMs: 414_000 }),
      track({ source: "deezer", title: "Hallelujah", artists: ["Rufus Wainwright"], album: "Shrek", durationMs: 409_000 }),
    ],
  ],
];

for (const [name, input] of keptApart) {
  test(name, () => assert.equal(mergeTracks(input).length, 2, name));
}

test("a title that is nothing but punctuation is not a name two songs can share", () => {
  // `...` and `???` both normalise away to nothing. Compared for equality, that nothing matched,
  // so two unrelated songs by one artist came out as one row — whose lead source then played the
  // other song.
  const songs = mergeTracks([
    track({ source: "apple", title: "...", artists: ["Wallace Cleaver"], album: "merci", durationMs: 122_000, sourceId: "dots" }),
    track({ source: "deezer", title: "???", artists: ["Wallace Cleaver"], album: "Marcel", durationMs: 122_400, sourceId: "marks" }),
  ]);
  assert.equal(songs.length, 2, "an empty title is not evidence that two recordings are one");
  assert.equal(new Set(songs.map((song) => song.id)).size, 2);
});

test("a title that is all brackets still groups on what the brackets say", () => {
  // `(Nice Dream)` leaves an empty base too, but the bracket is kept as a variant, and a variant
  // is something two sources can be compared on.
  const songs = mergeTracks([
    track({ source: "apple", title: "(Nice Dream)", artists: ["Radiohead"], album: "The Bends", durationMs: 233_227 }),
    track({ source: "deezer", title: "(Nice Dream)", artists: ["Radiohead"], album: "The Bends", durationMs: 233_000 }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(sourcesOf(songs[0]!), ["apple", "deezer"]);
});

test("an ISRC still carries a song whose title says nothing", () => {
  const songs = mergeTracks([
    track({ source: "deezer", title: "★", artists: ["David Bowie"], album: "Blackstar", durationMs: 597_000, isrc: "GBBKS1500214" }),
    track({ source: "soundcloud", title: "…", artists: ["David Bowie"], album: null, durationMs: 597_933, isrc: "gb-bks-15-00214" }),
  ]);
  assert.equal(songs.length, 1, "identity the title could not supply came from the ISRC");
});
