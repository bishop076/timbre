import assert from "node:assert/strict";
import { test } from "node:test";

import { actionFor, isTypingTarget } from "./transport-keys.ts";

function press(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {},
) {
  return actionFor({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    ...modifiers,
  });
}

/** A stand-in for an event target — `isTypingTarget` is duck-typed so this works. */
function element(tagName: string, attributes: Record<string, string> = {}) {
  return {
    tagName,
    isContentEditable: attributes.contenteditable === "true",
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

test("space toggles playback, under either key name", () => {
  assert.equal(press(" "), "toggle");
  // Older Firefox and Edge report this instead.
  assert.equal(press("Spacebar"), "toggle");
});

test("left and right skip tracks", () => {
  assert.equal(press("ArrowRight"), "next");
  assert.equal(press("ArrowLeft"), "previous");
});

test("up and down move the volume", () => {
  assert.equal(press("ArrowUp"), "volume-up");
  assert.equal(press("ArrowDown"), "volume-down");
});

test("keys Timbre does not claim are left alone", () => {
  for (const key of ["a", "Enter", "Tab", "/", "Escape", "PageDown", "Home"]) {
    assert.equal(press(key), null, `${key} should not be a transport action`);
  }
});

test("modified chords belong to the browser, not to Timbre", () => {
  // Cmd+← is "go back" and Ctrl+← is "previous word".
  assert.equal(press("ArrowLeft", { metaKey: true }), null);
  assert.equal(press("ArrowLeft", { ctrlKey: true }), null);
  assert.equal(press("ArrowRight", { altKey: true }), null);
  assert.equal(press(" ", { ctrlKey: true }), null);
});

test("shift alone still triggers, since it forms no browser chord here", () => {
  assert.equal(
    actionFor({ key: " ", ctrlKey: false, metaKey: false, altKey: false, target: null }),
    "toggle",
  );
});

test("typing a space into a field must not pause the music", () => {
  for (const tag of ["INPUT", "TEXTAREA", "SELECT", "input", "textarea"]) {
    assert.equal(isTypingTarget(element(tag)), true, `${tag} is text entry`);
  }
  assert.equal(
    actionFor({
      key: " ",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: element("INPUT"),
    }),
    null,
  );
});

test("space on a focused button activates it rather than the player", () => {
  // Stealing Space here would break every button in the app for keyboard users.
  assert.equal(isTypingTarget(element("BUTTON")), true);
  assert.equal(isTypingTarget(element("A")), true);
});

test("contenteditable counts as text entry", () => {
  assert.equal(isTypingTarget(element("DIV", { contenteditable: "true" })), true);
  assert.equal(isTypingTarget(element("DIV")), false);
});

test("elements standing in for controls via role are respected", () => {
  assert.equal(isTypingTarget(element("DIV", { role: "button" })), true);
  assert.equal(isTypingTarget(element("DIV", { role: "textbox" })), true);
  assert.equal(isTypingTarget(element("SPAN", { role: "presentation" })), false);
});

test("ordinary containers do not swallow the shortcut", () => {
  for (const tag of ["DIV", "SECTION", "MAIN", "LI", "BODY"]) {
    assert.equal(isTypingTarget(element(tag)), false, `${tag} should not block transport keys`);
  }
  assert.equal(isTypingTarget(null), false);
});

test("a target from another realm is still classified correctly", () => {
  // Why this is duck-typed: an element inside one of the app's iframes fails
  // `instanceof HTMLElement` against the parent's constructor.
  const foreign = Object.create(null) as Record<string, unknown>;
  foreign.tagName = "INPUT";
  assert.equal(isTypingTarget(foreign), true);
});
