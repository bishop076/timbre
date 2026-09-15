import assert from "node:assert/strict";
import { test } from "node:test";

import { createLocalStore, newId, writeJson } from "./local-store.ts";

function storage(setItem: (key: string, value: string) => void) {
  const backing: Record<string, string> = {};
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => setItem(key, value),
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
  };
  return backing;
}

test("an id is minted off a secure origin too", () => {
  // `crypto.randomUUID` is undefined outside a secure context, and this app is self-hostable
  // over plain http on a LAN address. The bare call took out `createPlaylist` entirely there.
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    const id = newId();
    assert.equal(typeof id, "string");
    assert.ok(id.length >= 8, "and it is long enough to tell two playlists apart");
    assert.notEqual(newId(), newId());
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
  }
});

test("a value that cannot be written is reported, not thrown", () => {
  storage((key, value) => {
    void key;
    void value;
  });

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  // `persist()` in the playlist store and `rememberCharts` both call this bare, so a throw here
  // came out of `createPlaylist` as an exception instead of as the storage failure it is.
  assert.equal(writeJson("timbre:test", cyclic), false);
  assert.equal(writeJson("timbre:test", () => 1), false);
  assert.equal(writeJson("timbre:test", { a: 1 }), true);
});

test("a store says whether its write landed", () => {
  const backing = storage((key, value) => {
    if (value.length > 4) throw new Error("QuotaExceededError");
    backing[key] = value;
  });

  const store = createLocalStore<string>({
    initial: "",
    read: () => "",
    write: (value) => writeJson("timbre:test", value),
  });

  assert.equal(store.save("ok"), true);
  // Publishing regardless is deliberate; saying nothing about the failure was not. A log that
  // only grows needs to know, or it stops recording with nothing anywhere saying so.
  assert.equal(store.save("far too long"), false);
  assert.equal(store.getSnapshot(), "far too long");

  const silent = createLocalStore<string>({ initial: "", read: () => "" });
  assert.equal(silent.save("no writer, nothing to fail"), true);
});
