import assert from "node:assert/strict";
import { test } from "node:test";

import { actionFor, isTypingTarget, runTransport, VOLUME_STEP } from "./transport-keys.ts";

function press(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "repeat", boolean>> = {},
  target: unknown = null,
) {
  return actionFor({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target,
    ...modifiers,
  });
}

function transport() {
  const taken: string[] = [];
  return {
    taken,
    volume: 50,
    toggle: () => taken.push("toggle"),
    next: () => taken.push("next"),
    previous: () => taken.push("previous"),
    setVolume: (level: number) => taken.push(`volume:${level}`),
  };
}

function run(key: string, target: unknown = null, repeat = false) {
  const api = transport();
  const claimed = runTransport(
    { key, ctrlKey: false, metaKey: false, altKey: false, repeat, target },
    api,
  );
  return { claimed, taken: api.taken };
}

function element(tagName: string, attributes: Record<string, string> = {}) {
  return {
    tagName,
    isContentEditable: attributes.contenteditable === "true",
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

test("space and the arrows map to transport actions, under either space name", () => {
  const expected = {
    " ": "toggle",
    Spacebar: "toggle",
    ArrowRight: "next",
    ArrowLeft: "previous",
    ArrowUp: "volume-up",
    ArrowDown: "volume-down",
  };
  for (const [key, action] of Object.entries(expected)) assert.equal(press(key), action, key);
});

test("keys Timbre does not claim are left alone", () => {
  for (const key of ["a", "Enter", "Tab", "/", "Escape", "PageDown", "Home"]) {
    assert.equal(press(key), null, `${key} should not be a transport action`);
  }
});

test("modified chords belong to the browser, not to Timbre", () => {
  assert.equal(press("ArrowLeft", { metaKey: true }), null);
  assert.equal(press("ArrowLeft", { ctrlKey: true }), null);
  assert.equal(press("ArrowRight", { altKey: true }), null);
  assert.equal(press(" ", { ctrlKey: true }), null);
});

test("text entry, controls and anything with a control's role own their keys", () => {
  const owners = [
    ...["INPUT", "TEXTAREA", "SELECT", "input", "textarea", "BUTTON", "A"].map((tag) => element(tag)),
    element("DIV", { contenteditable: "true" }),
    element("DIV", { role: "button" }),
    element("DIV", { role: "textbox" }),
  ];
  for (const owner of owners) assert.equal(isTypingTarget(owner), true, JSON.stringify(owner));
  assert.equal(press(" ", {}, element("INPUT")), null, "typing a space must not pause the music");
});

test("arrows on a focused slider seek or set the volume, and must not also skip", () => {
  const slider = element("DIV", { role: "slider" });
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
    assert.equal(press(key, {}, slider), null, `${key} on a slider belongs to the slider`);
  }
});

test("ordinary containers do not swallow the shortcut", () => {
  for (const tag of ["DIV", "SECTION", "MAIN", "LI", "BODY"]) {
    assert.equal(isTypingTarget(element(tag)), false, `${tag} should not block transport keys`);
  }
  assert.equal(isTypingTarget(element("SPAN", { role: "presentation" })), false);
  assert.equal(isTypingTarget(null), false);
});

test("a target from another realm is still classified correctly", () => {
  const foreign = Object.create(null) as Record<string, unknown>;
  foreign.tagName = "INPUT";
  assert.equal(isTypingTarget(foreign), true);
});

test("a widget that owns its own keys keeps them, so a menu is not also a transport", () => {
  // The anchored menu focuses its own container when it has no items to land on, which is
  // where Space was pausing the music with the menu still open.
  for (const role of ["menu", "menubar", "listbox", "option", "combobox", "tab", "switch"]) {
    const widget = element("DIV", { role });
    assert.equal(isTypingTarget(widget), true, `role=${role} owns its keys`);
    assert.equal(press(" ", {}, widget), null, `Space on role=${role} must not reach the transport`);
    assert.equal(
      press("ArrowDown", {}, widget),
      null,
      `ArrowDown on role=${role} must not reach the transport`,
    );
  }
});

test("a held key ramps the volume but does not strobe the transport", () => {
  assert.equal(press("ArrowUp", { repeat: true }), "volume-up");
  assert.equal(press("ArrowDown", { repeat: true }), "volume-down");
  for (const key of [" ", "Spacebar", "ArrowRight", "ArrowLeft"]) {
    assert.equal(press(key, { repeat: true }), null, `a held ${key} must fire once, not per repeat`);
  }
});

test("every key the transport takes is one the page must not also act on", () => {
  // Including the volume arrows: without this they set the volume and scrolled the page
  // behind the player at the same time.
  for (const [key, taken] of [
    [" ", "toggle"],
    ["ArrowRight", "next"],
    ["ArrowLeft", "previous"],
    ["ArrowUp", `volume:${50 + VOLUME_STEP}`],
    ["ArrowDown", `volume:${50 - VOLUME_STEP}`],
  ] as const) {
    const result = run(key);
    assert.equal(result.claimed, true, `${key} is Timbre's to claim`);
    assert.deepEqual(result.taken, [taken], key);
  }
});

test("a key the transport leaves alone is left for the page, and nothing runs without a track", () => {
  assert.deepEqual(run("/"), { claimed: false, taken: [] });
  assert.deepEqual(run(" ", element("INPUT")), { claimed: false, taken: [] });
  assert.equal(
    runTransport({ key: " ", ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null }, null),
    false,
    "nothing is playing, so the space bar is the page's",
  );
});
