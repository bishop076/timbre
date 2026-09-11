import assert from "node:assert/strict";
import { test } from "node:test";

import { csvField, playlistsToCsv } from "./csv.ts";

const song = {
  id: "a",
  title: "Wonderwall",
  artists: ["Oasis"],
  album: null,
  durationMs: 258_400,
  isrc: "GBAAA9500123",
  artworkUrl: null,
  sources: [
    { source: "ytmusic", sourceId: "x", url: "https://music.youtube.com/watch?v=x", playback: "queue" as const },
    { source: "deezer", sourceId: "1", url: null, playback: "link" as const },
  ],
};

test("plain text is left alone, and quotes, commas and newlines are quoted", () => {
  assert.equal(csvField("Oasis"), "Oasis");
  assert.equal(csvField("Crosby, Stills & Nash"), '"Crosby, Stills & Nash"');
  assert.equal(csvField('The "Blue" Album'), '"The ""Blue"" Album"');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
});

test("a cell a spreadsheet would run as a formula is made text", () => {
  assert.equal(csvField('=HYPERLINK("https://evil.example","x")'), `"'=HYPERLINK(""https://evil.example"",""x"")"`);
  assert.equal(csvField("+1"), "'+1");
  assert.equal(csvField("-remix"), "'-remix");
  assert.equal(csvField("@here"), "'@here");
});

test("one row per entry, with a BOM and CRLF for spreadsheets", () => {
  const csv = playlistsToCsv([{ name: "Road trip", songs: [song, { ...song, id: "b", title: "Live Forever", durationMs: null }] }]);
  assert.ok(csv.startsWith("﻿Playlist,#,Title,"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[1], "Road trip,1,Wonderwall,Oasis,,4:18,GBAAA9500123,ytmusic deezer,https://music.youtube.com/watch?v=x");
  assert.equal(lines[2], "Road trip,2,Live Forever,Oasis,,,GBAAA9500123,ytmusic deezer,https://music.youtube.com/watch?v=x");
  assert.equal(lines[3], "");
});
