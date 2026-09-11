import assert from "node:assert/strict";
import { test } from "node:test";

import { pastedCollectionOf, youtubePlaylistPath } from "./pasted-collection.ts";

const LIST = "PL11WrGDTdUZL4uIIT7DsKk7cfzPiIsqat";
const ALBUM = "OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw";

test("every host a YouTube playlist link is shared from opens the same page", () => {
  for (const link of [
    `https://www.youtube.com/playlist?list=${LIST}`,
    `https://youtube.com/playlist?list=${LIST}`,
    `https://m.youtube.com/playlist?list=${LIST}`,
    `https://music.youtube.com/playlist?list=${LIST}`,
    `https://music.youtube.com/playlist?list=${LIST}&si=AbCdEf123`,
    `  https://www.youtube.com/playlist/?list=${LIST}  `,
  ]) {
    const found = youtubePlaylistPath(link);
    assert.equal(found?.href, `/collection/ytmusic-playlist/${LIST}`, link);
    assert.equal(found?.withSong, false, link);
  }
});

test("the card names the service the link came from", () => {
  assert.equal(youtubePlaylistPath(`https://music.youtube.com/playlist?list=${LIST}`)?.service, "YouTube Music");
  assert.equal(youtubePlaylistPath(`https://www.youtube.com/playlist?list=${LIST}`)?.service, "YouTube");
});

test("an album's list is called an album", () => {
  const found = youtubePlaylistPath(`https://music.youtube.com/playlist?list=${ALBUM}`);
  assert.equal(found?.noun, "album");
  assert.equal(found?.href, `/collection/ytmusic-playlist/${ALBUM}`);
});

test("a song played from a list offers the list and keeps the song", () => {
  for (const link of [
    `https://www.youtube.com/watch?v=hpSrLjc5SMs&list=${LIST}&index=3`,
    `https://music.youtube.com/watch?v=hpSrLjc5SMs&list=${LIST}`,
    `https://youtu.be/hpSrLjc5SMs?list=${LIST}`,
  ]) {
    const found = youtubePlaylistPath(link);
    assert.equal(found?.href, `/collection/ytmusic-playlist/${LIST}`, link);
    assert.equal(found?.withSong, true, link);
  }
});

test("YouTube Music's own editorial playlists open", () => {
  const id = "RDCLAK5uy_kb7EBi6y3GrtJri4_ZH56Ms786DFEimbM";
  assert.equal(youtubePlaylistPath(`https://music.youtube.com/playlist?list=${id}`)?.href, `/collection/ytmusic-playlist/${id}`);
});

test("a mix, a personal list and a plain song offer nothing", () => {
  for (const link of [
    // The `list=` on a song opened from a radio mix: no playlist page exists behind it.
    "https://music.youtube.com/watch?v=fa5IWHDbftI&list=RDAMVMfa5IWHDbftI",
    "https://www.youtube.com/playlist?list=LL",
    "https://www.youtube.com/playlist?list=WL",
    "https://www.youtube.com/watch?v=hpSrLjc5SMs",
    "https://youtu.be/hpSrLjc5SMs",
    `https://www.youtube.com/watch?list=${LIST}`,
    `https://www.youtube.com/channel/UC123?list=${LIST}`,
  ]) {
    assert.equal(youtubePlaylistPath(link), null, link);
  }
});

test("anything that is not a YouTube link offers nothing", () => {
  for (const link of [
    "",
    "daft punk",
    `youtube.com/playlist?list=${LIST}`,
    `https://notyoutube.com/playlist?list=${LIST}`,
    `https://youtube.com.evil.test/playlist?list=${LIST}`,
    `https://www.youtube.com/playlist?list=${LIST}%2F..%2F..`,
    `https://www.youtube.com/playlist?list=<script>`,
  ]) {
    assert.equal(youtubePlaylistPath(link), null, link);
  }
});

test("Spotify links keep opening as they did", () => {
  const found = pastedCollectionOf("https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa?si=x");
  assert.deepEqual(found, {
    service: "Spotify",
    noun: "album",
    href: "/collection/spotify-album/4m2880jivSbbyEGAKfITCa",
    withSong: false,
  });
  assert.equal(pastedCollectionOf(`https://music.youtube.com/playlist?list=${LIST}`)?.service, "YouTube Music");
  assert.equal(pastedCollectionOf("https://open.spotify.com/track/4m2880jivSbbyEGAKfITCa"), null);
});
