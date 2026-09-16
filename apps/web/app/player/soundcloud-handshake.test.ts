import assert from "node:assert/strict";
import { test } from "node:test";

import { widgetHandoff, widgetStep } from "./soundcloud-handshake.ts";

const A = "https://soundcloud.com/artist/one";
const B = "https://soundcloud.com/artist/two";

test("a widget already holding the wanted track only has to be played", () => {
  assert.deepEqual(widgetStep(A, A), { do: "play" });
});

test("a track that arrived during the handshake is loaded, not played over", () => {
  // The iframe was built with A and has just said READY; B was picked while it was loading.
  assert.deepEqual(widgetStep(A, B), { do: "load", url: B });
  // And the same question from the other direction: the widget holds nothing yet.
  assert.deepEqual(widgetStep(null, B), { do: "load", url: B });
});

test("with nothing wanted there is nothing to do — no play of whatever is left loaded", () => {
  assert.deepEqual(widgetStep(A, null), { do: "nothing" });
  assert.deepEqual(widgetStep(null, null), { do: "nothing" });
});

test("a url handed to a widget that is still handshaking is waited for", () => {
  assert.equal(widgetHandoff(A, { ready: false, failed: false }), "wait");
});

test("a ready widget takes the url", () => {
  assert.equal(widgetHandoff(A, { ready: true, failed: false }), "apply");
  // A widget that failed once and then arrived is a working widget.
  assert.equal(widgetHandoff(A, { ready: true, failed: true }), "apply");
});

test("a second url on a mount whose widget never loaded is reported, not swallowed", () => {
  // The rescue below SoundCloud can itself land on SoundCloud, and it reaches this same mount.
  assert.equal(widgetHandoff(B, { ready: false, failed: true }), "report");
});

test("no url is nothing to report", () => {
  assert.equal(widgetHandoff(null, { ready: false, failed: true }), "wait");
});
