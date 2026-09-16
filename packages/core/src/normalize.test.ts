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

// The numbers in the comments are what the old code did on this machine, measured the same
// way. The budgets are deliberately loose — a hundred-fold margin over what the fixed code
// costs — because this asserts "not catastrophic", not "fast".
const millis = (work: () => unknown): number => {
  const started = process.hrtime.bigint();
  work();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

test("a title made of repeated tags is answered, not chewed on", () => {
  // `(?:\s+(?:<tag>|…))+\s*$` read N repetitions 2^N ways. At the 300 characters
  // /api/lyrics already allows on its `title`, that was 3.0 seconds of blocked event loop
  // for one GET; through dedupeKey, which nothing caps, 367 characters cost 139 seconds.
  const atTheCap = ("song" + " remaster".repeat(33)).slice(0, 297) + " zz";
  assert.equal(atTheCap.length, 300);
  assert.ok(
    millis(() => parseTitle(atTheCap)) < 100,
    "parseTitle backtracks catastrophically on a run of trailing tags",
  );
  assert.ok(
    millis(() => dedupeKey("song" + " remaster".repeat(40) + " zz", ["x"])) < 100,
    "dedupeKey backtracks catastrophically on a run of trailing tags",
  );
});

test("a title long enough to be a payload is read as far as a title goes", () => {
  // The bracket scan is quadratic: 40,000 open brackets cost 7.3 seconds in the regex alone.
  // `mergeTracks` hands it whatever an uploader typed, so the length stops at MAX_TITLE.
  assert.ok(
    millis(() => parseTitle("(".repeat(100_000))) < 100,
    "parseTitle scans an unbounded title quadratically",
  );
  assert.equal(
    parseTitle("Wonderwall" + " ".repeat(2_000) + "(Live)").variants.length,
    0,
    "past the cap there is nothing left to read",
  );
  assert.equal(parseTitle("Wonderwall (Live)".padEnd(400, "!")).base.startsWith("wonderwall"), true);
});

test("peeling trailing tags one at a time reads the same titles as swallowing them whole", () => {
  assert.equal(parseTitle("Wonderwall - Remastered 2011").base, "wonderwall");
  assert.equal(parseTitle("Wonderwall Deluxe Remaster").base, "wonderwall");
  assert.equal(parseTitle("Wonderwall Official Video HD Explicit").base, "wonderwall");
  assert.equal(parseTitle("Wonderwall Remastered   ").base, "wonderwall");
  assert.equal(parseTitle("Remastered").base, "remastered", "a title that is only a tag stays");
});
