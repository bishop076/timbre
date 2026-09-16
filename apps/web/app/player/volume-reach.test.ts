import assert from "node:assert/strict";
import { test } from "node:test";

import { volumeOutOfReach } from "./volume-reach.ts";

test("the five players that take a level leave the control alone", () => {
  for (const kind of ["ytmusic", "soundcloud", "mixcloud", "progressive", "preview"]) {
    assert.equal(volumeOutOfReach(kind, false), null, kind);
  }
  assert.equal(volumeOutOfReach(null, false), null, "nothing playing is not a reason");
});

test("the two subscription embeds have no API at all, connected or not", () => {
  assert.ok(volumeOutOfReach("subscription", false));
  assert.ok(volumeOutOfReach("subscription", true));
});

test("Spotify turns on the account, because only the SDK has a setVolume", () => {
  // Signed out it is always the 30-second embed, whose controller exposes no volume or mute.
  assert.ok(volumeOutOfReach("spotify", false));
  // Connected, the Web Playback SDK plays it and does take a level — never grey that out.
  assert.equal(volumeOutOfReach("spotify", true), null);
});
