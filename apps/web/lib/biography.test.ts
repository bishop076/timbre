import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enwikiTitleFrom,
  findBiography,
  pickArtist,
  readSummary,
  sharesARelease,
  sitelinkTitle,
  soleEntity,
  wikidataIdFrom,
} from "./biography.ts";

// Fixtures are trimmed from real answers, measured 2026-09-11.

const sades = [
  { id: "band", name: "Sade", score: 100 },
  { id: "brazil", name: "Sade", score: 73 },
  { id: "turkey", name: "Sade", score: 72 },
];

test("the well-known namesake MusicBrainz is sure of, not the others", () => {
  assert.equal(pickArtist("Sade", sades), "band");
});

test("a search that was only close picks nobody", () => {
  // "radiohead 3" and "DJ Radiohead" are what a search for Radiohead returns after the band.
  const near = [
    { id: "a", name: "radiohead 3", score: 57 },
    { id: "b", name: "DJ Radiohead", score: 57 },
  ];
  assert.equal(pickArtist("Radiohead", near), null);
  // The right name with a doubtful score is still doubtful.
  assert.equal(pickArtist("Flume", [{ id: "pt", name: "Flume", score: 80 }]), null);
  // And a confident score on a different name is a different artist.
  assert.equal(pickArtist("Boiler Room", [{ id: "c", name: "Boiler Room Collective", score: 100 }]), null);
});

test("accents and punctuation do not stop a match, and the exact spelling wins a tie", () => {
  assert.equal(pickArtist("Sigur Ros", [{ id: "sr", name: "Sigur Rós", score: 100 }]), "sr");
  const two = [
    { id: "loose", name: "Sigur Ros", score: 100 },
    { id: "exact", name: "Sigur Rós", score: 100 },
  ];
  assert.equal(pickArtist("sigur rós", two), "exact");
});

test("an empty name matches nothing", () => {
  assert.equal(pickArtist("  ", sades), null);
  assert.equal(pickArtist("Sade", []), null);
});

test("Wikidata and English Wikipedia links are read out of MusicBrainz relations", () => {
  const relations = [
    { type: "official homepage", url: { resource: "https://example.com/" } },
    { type: "wikipedia", url: { resource: "https://de.wikipedia.org/wiki/Boiler_Room" } },
    { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q4938334" } },
    { type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Boiler_Room_(band)" } },
  ];
  assert.equal(wikidataIdFrom(relations), "Q4938334");
  // The German article is skipped for the English one, and the title is decoded.
  assert.equal(enwikiTitleFrom(relations), "Boiler Room (band)");
  assert.equal(
    enwikiTitleFrom([{ type: "wikipedia", url: { resource: "https://en.wikipedia.org/wiki/Sigur_R%C3%B3s" } }]),
    "Sigur Rós",
  );
});

test("no links, or links to other things, give nothing", () => {
  assert.equal(wikidataIdFrom(undefined), null);
  assert.equal(enwikiTitleFrom([]), null);
  assert.equal(wikidataIdFrom([{ type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Property:P2722" } }]), null);
  assert.equal(enwikiTitleFrom([{ type: "discogs", url: { resource: "https://en.wikipedia.org/wiki/Radiohead" } }]), null);
});

test("a Deezer id claimed by exactly one entity names it; two claimants name nobody", () => {
  assert.equal(soleEntity({ query: { search: [{ title: "Q44190" }] } }), "Q44190");
  // Deezer's "Sade" (202) is claimed by both the band and the singer.
  assert.equal(soleEntity({ query: { search: [{ title: "Q658182" }, { title: "Q194187" }] } }), null);
  assert.equal(soleEntity({ query: { search: [] } }), null);
  assert.equal(soleEntity(null), null);
});

test("the enwiki sitelink is read from a wbgetentities answer", () => {
  const body = { entities: { Q658182: { sitelinks: { enwiki: { title: "Sade (band)" } } } } };
  assert.equal(sitelinkTitle(body, "Q658182"), "Sade (band)");
  // An entity with no English article.
  assert.equal(sitelinkTitle({ entities: { Q1: { sitelinks: {} } } }, "Q1"), null);
  assert.equal(sitelinkTitle(null, "Q1"), null);
});

test("a name match needs a release in common to count", () => {
  const band = ["Boiler Room", "Can't Breathe", "Rectify"];
  // The broadcaster's catalogue shares only the self-titled record, which proves nothing.
  assert.equal(sharesARelease("Boiler Room", ["Boiler Room", "Boiler Room x Dekmantel"], band), false);
  assert.equal(sharesARelease("Boiler Room", ["Can't Breathe"], band), true);
  // Reissue noise on one side does not hide the match.
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

test("a disambiguation page is not a biography", () => {
  assert.equal(
    readSummary({
      type: "disambiguation",
      title: "Sade",
      extract: "Sade may refer to:",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Sade" } },
    }),
    null,
  );
});

test("an article with no prose is not a biography, and the URL is rebuilt when absent", () => {
  assert.equal(readSummary({ ...radiohead, extract: "   " }), null);
  assert.equal(readSummary({ ...radiohead, type: "no-extract" }), null);
  assert.equal(readSummary(null), null);
  const bare = readSummary({ type: "standard", title: "AC/DC", extract: "AC/DC are an Australian rock band." });
  assert.equal(bare?.url, "https://en.wikipedia.org/wiki/AC%2FDC");
});

test("without a Deezer profile there is nothing to corroborate, so no lookup happens", async () => {
  // Would reach the network if it went any further; the test runs offline.
  assert.equal(await findBiography({ name: "Radiohead", deezerId: null, releaseTitles: [] }), null);
  assert.equal(await findBiography({ name: "Radiohead", deezerId: "../399", releaseTitles: [] }), null);
});
