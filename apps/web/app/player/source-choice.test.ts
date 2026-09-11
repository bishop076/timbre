import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_ENTRIES, afterFailure, afterPick, choiceKey, type SourceChoices } from "./source-choice.ts";

const key = choiceKey({ title: "Delilah (pull me out of this)", artists: ["Fred again.."] });

test("the same recording under a decorated title shares one key", () => {
  // The case `songKey` misses: a YouTube upload's title against the catalogue's.
  assert.equal(
    choiceKey({ title: "As It Was (Official Video)", artists: ["Harry Styles"] }),
    choiceKey({ title: "As It Was", artists: ["Harry Styles"] }),
  );
});

test("a live take is a different recording, so its pick is its own", () => {
  assert.notEqual(
    choiceKey({ title: "Wonderwall (Live)", artists: ["Oasis"] }),
    choiceKey({ title: "Wonderwall", artists: ["Oasis"] }),
  );
});

test("a source that plays the whole song by itself is remembered", () => {
  assert.deepEqual(afterPick({}, key, "soundcloud", "queue"), { [key]: "soundcloud" });
  assert.deepEqual(afterPick({ [key]: "soundcloud" }, key, "audius", "queue"), { [key]: "audius" });
});

test("picking YouTube Music again goes back to the default", () => {
  assert.deepEqual(afterPick({ [key]: "soundcloud", other: "audius" }, key, "ytmusic", "queue"), {
    other: "audius",
  });
});

test("a clip or a pressed embed is a choice for now and changes nothing", () => {
  const choices: SourceChoices = { [key]: "soundcloud" };
  assert.equal(afterPick(choices, key, "deezer", "preview"), choices);
  assert.equal(afterPick(choices, key, "apple", "manual"), choices);
  assert.equal(afterPick(choices, key, "spotify", "manual"), choices);
  assert.equal(key in afterPick({}, key, "deezer", "preview"), false);
});

test("the remembered source failing forgets it, and nothing else does", () => {
  const choices: SourceChoices = { [key]: "soundcloud" };
  assert.deepEqual(afterFailure(choices, key, "soundcloud"), {});
  // A clip pressed on top of the pick failed, not the pick.
  assert.equal(afterFailure(choices, key, "deezer"), choices);
  assert.equal(afterFailure(choices, "someone else", "soundcloud"), choices);
});

test("the map is bounded, and a fresh pick counts as recent", () => {
  let choices: SourceChoices = {};
  for (let index = 0; index < MAX_ENTRIES; index += 1) {
    choices = afterPick(choices, `song ${index}`, "soundcloud", "queue");
  }
  // Re-picking the oldest moves it to the end, so the next eviction takes `song 1` instead.
  choices = afterPick(choices, "song 0", "audius", "queue");
  choices = afterPick(choices, "one more", "audius", "queue");

  assert.equal(Object.keys(choices).length, MAX_ENTRIES);
  assert.equal(choices["song 0"], "audius");
  assert.equal("song 1" in choices, false);
  assert.equal(choices["one more"], "audius");
});
