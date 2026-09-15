import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  canCorroborate,
  enwikiTitleFrom,
  findBiography,
  pickArtist,
  readSummary,
  sharesARelease,
  soleEntity,
  wikidataIdFrom,
} from "./biography.ts";

const sades = [
  { id: "band", name: "Sade", score: 100 },
  { id: "brazil", name: "Sade", score: 73 },
  { id: "turkey", name: "Sade", score: 72 },
];

test("the namesake MusicBrainz is sure of, accents aside, with the exact spelling winning a tie", () => {
  assert.equal(pickArtist("Sade", sades), "band");
  assert.equal(pickArtist("Sigur Ros", [{ id: "sr", name: "Sigur Rós", score: 100 }]), "sr");
  const two = [
    { id: "loose", name: "Sigur Ros", score: 100 },
    { id: "exact", name: "Sigur Rós", score: 100 },
  ];
  assert.equal(pickArtist("sigur rós", two), "exact");
});

test("a search that was only close, or an empty name, picks nobody", () => {
  const near = [
    { id: "a", name: "radiohead 3", score: 57 },
    { id: "b", name: "DJ Radiohead", score: 57 },
  ];
  assert.equal(pickArtist("Radiohead", near), null);
  assert.equal(pickArtist("Flume", [{ id: "pt", name: "Flume", score: 80 }]), null);
  assert.equal(pickArtist("Boiler Room", [{ id: "c", name: "Boiler Room Collective", score: 100 }]), null);
  assert.equal(pickArtist("  ", sades), null);
  assert.equal(pickArtist("Sade", []), null);
});

test("Wikidata and English Wikipedia links are read out of MusicBrainz relations, and nothing else", () => {
  const relations = [
    { type: "official homepage", url: { resource: "https://example.com/" } },
    { type: "wikipedia", url: { resource: "https://de.wikipedia.org/wiki/Boiler_Room" } },
    { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q4938334" } },
    { type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Boiler_Room_(band)" } },
  ];
  assert.equal(wikidataIdFrom(relations), "Q4938334");
  assert.equal(enwikiTitleFrom(relations), "Boiler Room (band)");
  const escaped = { type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Sigur_R%C3%B3s" } };
  assert.equal(enwikiTitleFrom([escaped]), "Sigur Rós");

  assert.equal(wikidataIdFrom(undefined), null);
  assert.equal(enwikiTitleFrom([]), null);
  const property = { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Property:P2722" } };
  assert.equal(wikidataIdFrom([property]), null);
  const mislabelled = { type: "discogs", url: { resource: "https://en.wikipedia.org/wiki/Radiohead" } };
  assert.equal(enwikiTitleFrom([mislabelled]), null);
});

test("a Deezer id claimed by exactly one entity names it; two claimants name nobody", () => {
  assert.equal(soleEntity({ query: { search: [{ title: "Q44190" }] } }), "Q44190");
  assert.equal(soleEntity({ query: { search: [{ title: "Q658182" }, { title: "Q194187" }] } }), null);
  assert.equal(soleEntity({ query: { search: [] } }), null);
  assert.equal(soleEntity(null), null);
});

test("a name match needs a release in common to count", () => {
  const band = ["Boiler Room", "Can't Breathe", "Rectify"];
  assert.equal(sharesARelease("Boiler Room", ["Boiler Room", "Boiler Room x Dekmantel"], band), false);
  assert.equal(sharesARelease("Boiler Room", ["Can't Breathe"], band), true);
  assert.equal(sharesARelease("Sade", ["Diamond Life (Remastered)"], ["Diamond Life", "Promise"]), true);
  assert.equal(sharesARelease("Sade", [], ["Diamond Life"]), false);
});

const radiohead = {
  type: "standard",
  title: "Radiohead",
  extract:
    "Radiohead are an English rock band formed in Abingdon, Oxfordshire, in 1985. The band members are Thom Yorke ; the brothers Jonny Greenwood and Colin Greenwood (bass).",
  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Radiohead" } },
};

test("a standard article becomes a biography, with the stray spaces closed up", () => {
  const bio = readSummary(radiohead);
  assert.ok(bio);
  assert.equal(bio.title, "Radiohead");
  assert.equal(bio.url, "https://en.wikipedia.org/wiki/Radiohead");
  assert.match(bio.extract, /Thom Yorke; the brothers/);
});

test("a disambiguation page, or one with no prose, is not a biography", () => {
  assert.equal(readSummary({ ...radiohead, type: "disambiguation", extract: "Sade may refer to:" }), null);
  assert.equal(readSummary({ ...radiohead, extract: "   " }), null);
  assert.equal(readSummary({ ...radiohead, type: "no-extract" }), null);
  assert.equal(readSummary(null), null);
});

test("the URL is rebuilt when absent, slashes escaped", () => {
  const bare = readSummary({ type: "standard", title: "AC/DC", extract: "AC/DC are an Australian rock band." });
  assert.equal(bare?.url, "https://en.wikipedia.org/wiki/AC%2FDC");
});

test("without a Deezer profile there is nothing to corroborate, so no lookup happens", async () => {
  assert.equal(await findBiography({ name: "Radiohead", deezerId: null, releaseTitles: [] }), null);
  assert.equal(await findBiography({ name: "Radiohead", deezerId: "../399", releaseTitles: [] }), null);
});

test("a discography of nothing, or of nothing but the artist's own name, corroborates nothing", () => {
  assert.equal(canCorroborate({ name: "Sade", deezerId: "1", releaseTitles: [] }), false);
  assert.equal(canCorroborate({ name: "Sade", deezerId: "1", releaseTitles: ["Sade"] }), false);
  assert.equal(canCorroborate({ name: "Sade", deezerId: "1", releaseTitles: ["Promise"] }), true);
});

const globalForBiography = globalThis as unknown as {
  __timbreBiographyCache?: unknown;
  __timbreMusicBrainzNextSlot?: number;
};

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  delete globalForBiography.__timbreBiographyCache;
  globalForBiography.__timbreMusicBrainzNextSlot = 0;
});

// Wikidata knows of nobody holding this Deezer id, and MusicBrainz knows of nobody by the name:
// every lookup below ends in `null`, and what is being asserted is which requests were spent
// reaching it — and whether that `null` was worth remembering.
function asking(): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const body = url.includes("musicbrainz.org") ? { artists: [] } : { query: { search: [] } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return asked;
}

const musicBrainz = (url: string) => url.includes("musicbrainz.org");

test("with no releases to match on, MusicBrainz is not asked and the empty answer is not kept", async () => {
  delete globalForBiography.__timbreBiographyCache;
  globalForBiography.__timbreMusicBrainzNextSlot = 0;
  const asked = asking();

  // Deezer was rate limiting when this page rendered, so the discography arrived empty. The name
  // path cannot answer without one, and every MusicBrainz call takes a slot in a 1.1s queue that
  // real lookups are waiting in.
  assert.equal(await findBiography({ name: "Radiohead", deezerId: "399", releaseTitles: [] }), null);
  assert.equal(asked.filter(musicBrainz).length, 0);

  // And the nothing it found is not a fact about Radiohead, so the next request — by which time
  // the discography is back — looks again rather than being served a day of the outage.
  assert.equal(
    await findBiography({ name: "Radiohead", deezerId: "399", releaseTitles: ["Kid A"] }),
    null,
  );
  assert.ok(asked.some(musicBrainz));

  // That one *is* a fact: it was corroborable, it was looked up, and it is cached as before.
  const spent = asked.length;
  assert.equal(
    await findBiography({ name: "Radiohead", deezerId: "399", releaseTitles: ["Kid A"] }),
    null,
  );
  assert.equal(asked.length, spent);
});
