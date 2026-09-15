import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeKey,
  durationsMatch,
  normalizeArtists,
  normalizeLoose,
  parseTitle,
  parseVersions,
  versionTags,
} from "./normalize.ts";

test("noise that does not change the recording is stripped and leaves no variant behind", () => {
  for (const title of [
    "Wonderwall (Remastered 2011)",
    "Wonderwall - 2011 Remaster",
    "Wonderwall (Official Video)",
    "Wonderwall [HD]",
    "Wonderwall (Deluxe Edition)",
    "Wonderwall (Remastered Version)",
    "Wonderwall - Remastered Version",
    "Wonderwall (Deluxe Version)",
    "Wonderwall (30th Anniversary Edition)",
    "Wonderwall (25th Anniversary Remaster)",
    "Wonderwall Official Video",
    "Wonderwall HD",
  ]) {
    assert.deepEqual(parseTitle(title), { base: "wonderwall", variants: [], featured: [] }, title);
  }
});

test("a soundtrack credit is noise, in quotes of either kind", () => {
  const plain = dedupeKey("Let It Go", ["Idina Menzel"]);
  for (const title of [
    'Let It Go (From "Frozen")',
    'Let It Go - From "Frozen"',
    "Let It Go (From “Frozen”)",
  ]) {
    assert.equal(dedupeKey(title, ["Idina Menzel"]), plain, title);
  }
});

test("keeps variant markers so a live cut never matches the studio take", () => {
  const live = parseTitle("Redbone (Live)");
  assert.equal(live.base, parseTitle("Redbone").base, "base title should be shared");
  assert.deepEqual(parseTitle("Redbone").variants, []);
  assert.deepEqual(live.variants, ["live"]);
  assert.deepEqual(parseTitle("Redbone - Kaytranada Remix").variants, ["remix"]);
  assert.notEqual(dedupeKey("Redbone", ["Childish Gambino"]), dedupeKey("Redbone (Live)", ["Childish Gambino"]));
});

test("keeps unrecognized bracketed text as a distinguishing variant", () => {
  assert.equal(parseTitle("Wonderwall (Unplugged)").base, "wonderwall");
  for (const title of ["Wonderwall (Unplugged)", "Wonderwall (Glastonbury 1995)"]) {
    assert.notDeepEqual(parseTitle(title).variants, [], title);
    assert.notEqual(dedupeKey("Wonderwall", ["Oasis"]), dedupeKey(title, ["Oasis"]), title);
  }
});

test("guest credits come out of the title, but a bare 'with' mid-title stays in it", () => {
  for (const [title, base, featured] of [
    ["Sunflower (feat. Swae Lee)", "sunflower", ["swae lee"]],
    ["Save Your Tears (with Ariana Grande)", "save your tears", ["ariana grande"]],
    ["Save Your Tears - with Ariana Grande", "save your tears", ["ariana grande"]],
    ["Stay With Me", "stay with me", []],
    ["Dancing With Myself", "dancing with myself", []],
    ["The Girl With The Faraway Eyes", "the girl with the faraway eyes", []],
  ] as const) {
    const parsed = parseTitle(title);
    assert.equal(parsed.base, base, title);
    assert.deepEqual(parsed.featured, featured, title);
  }
});

test("a guest credit inside a bracket does not erase the variant beside it", () => {
  const live = parseTitle("Wonderwall (Live with Orchestra)");
  assert.deepEqual(live.variants, ["live"]);
  assert.deepEqual(live.featured, ["orchestra"]);
  assert.deepEqual(parseTitle("Blinding Lights (Remix feat. Rosalía)").variants, ["remix"]);
  assert.notEqual(
    dedupeKey("Wonderwall", ["Oasis"]),
    dedupeKey("Wonderwall (Live with Orchestra)", ["Oasis"]),
    "a live cut with a guest is still a live cut",
  );
});

test("a title that is itself a noise word is a title, not decoration", () => {
  assert.equal(parseTitle("Clean").base, "clean");
  assert.equal(parseTitle("Special").base, "special");
  assert.equal(parseTitle("Stereo Hearts").base, "stereo hearts");
  assert.notEqual(dedupeKey("Clean", ["Taylor Swift"]), dedupeKey("Special", ["Taylor Swift"]));
});

test("normalizes diacritics, ampersands and punctuation", () => {
  assert.deepEqual(normalizeArtists(["Beyoncé"]), ["beyonce"]);
  assert.deepEqual(normalizeArtists(["Simon & Garfunkel"]), ["garfunkel", "simon"]);
  assert.deepEqual(normalizeArtists(["Tyler, The Creator"]), ["the creator", "tyler"]);
});

test("dedupeKey ignores credit order and feat. placement", () => {
  assert.equal(
    dedupeKey("Sunflower (feat. Swae Lee)", ["Post Malone"]),
    dedupeKey("Sunflower", ["Post Malone", "Swae Lee"]),
  );
});

test("a dash that only repeats the credited artist is a byline, not a variant", () => {
  // SoundCloud, Audius and Mixcloud uploaders title tracks the way they name files, in both
  // orders. Either way the copy has to land on the same dedupe key as the catalogue's.
  assert.deepEqual(parseTitle("Jóga - Björk", ["Björk"]), {
    base: "joga",
    variants: [],
    featured: [],
  });
  assert.deepEqual(parseTitle("Nirvana - Smells Like Teen Spirit", ["Nirvana"]), {
    base: "smells like teen spirit",
    variants: [],
    featured: [],
  });
  assert.equal(dedupeKey("Jóga - Björk", ["Björk"]), dedupeKey("Jóga", ["Björk"]));
  assert.equal(
    dedupeKey("Sylow & Pierre Leck - There Is No Wonderwall", ["Sylow & Pierre Leck"]),
    dedupeKey("There Is No Wonderwall", ["Sylow", "Pierre Leck"]),
    "a joint byline is still a byline",
  );
});

test("a dash that says something about the recording keeps saying it", () => {
  assert.deepEqual(parseTitle("Wonderwall - Live", ["Oasis"]).variants, ["live"]);
  assert.deepEqual(parseTitle("Wonderwall - 2011 Remaster", ["Oasis"]).variants, []);
  assert.equal(parseTitle("Wonderwall - 2011 Remaster", ["Oasis"]).base, "wonderwall");
  assert.deepEqual(
    parseTitle("Jóga - Björk", ["Radiohead"]).variants,
    ["bjork"],
    "an uncredited name is not this track's byline",
  );
  assert.equal(
    parseTitle("Wonderwall", ["Wonderwall"]).base,
    "wonderwall",
    "a title that is only the artist name is still the title",
  );
});

test("version tags fold every spelling onto the tag callers compare", () => {
  assert.deepEqual(versionTags("Wonderwall (Live at Wembley)"), ["live"]);
  assert.deepEqual(versionTags("Wonderwall - Tribute Version"), ["cover"]);
  assert.deepEqual(versionTags("Wonderwall (In the Style of Oasis)"), ["karaoke"]);
  assert.deepEqual(versionTags("Wonderwall (Slowed + Reverb)"), ["speed"]);
  assert.deepEqual(versionTags("Wonderwall"), []);
  assert.deepEqual(versionTags("Wonderwall (Acoustic Cover, Live)"), ["acoustic", "cover", "live"]);
});

test("parseVersions leaves the song behind when it takes the version away", () => {
  assert.equal(normalizeLoose(parseVersions("wonderwall live").rest), "wonderwall");
  assert.deepEqual(parseVersions("wonderwall live").tags, ["live"]);
  assert.equal(normalizeLoose(parseVersions("wonderwall").rest), "wonderwall");
  assert.deepEqual(parseVersions("wonderwall").tags, []);
});

test("duration tolerance absorbs provider disagreement but not real differences", () => {
  assert.ok(durationsMatch(201_000, 203_000), "2s apart is the same recording");
  assert.ok(!durationsMatch(201_000, 260_000), "a minute apart is not");
  assert.ok(durationsMatch(201_000, null), "unknown duration is not evidence against a match");
});
