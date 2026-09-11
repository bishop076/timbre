import assert from "node:assert/strict";
import { test } from "node:test";

import { actionFor, isTypingTarget } from "./transport-keys.ts";

function press(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {},
  target: unknown = null,
) {
  return actionFor({ key, ctrlKey: false, metaKey: false, altKey: false, target, ...modifiers });
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
