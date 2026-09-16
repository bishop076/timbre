/**
 * Whether this browser already has a profile — the one answer that decides, with nothing asked,
 * whether the profile inside an imported backup replaces the reader's own.
 *
 * The pictures live in IndexedDB. The thumbnails beside them in `localStorage` are a painting of
 * them and can be refused on their own, so only one of the two is an honest answer to "is there
 * a picture here". These tests never write a thumbnail at all: that is the state a full
 * `localStorage` leaves behind, and the state the wrong answer was given in.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const backing: Record<string, string> = {};
const pictures = new Map<string, unknown>();

function request<T>(result: T) {
  const pending = {
    result,
    error: null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as (() => void) | null,
  };
  queueMicrotask(() => pending.onsuccess?.());
  return pending;
}

/** Enough of IndexedDB for `image-store.ts`: one database, one object store, one key at a time. */
const objectStore = {
  get: (key: string) => request(pictures.get(key)),
  put: (value: unknown, key: string) => {
    pictures.set(key, value);
    return request(undefined);
  },
  delete: (key: string) => {
    pictures.delete(key);
    return request(undefined);
  },
  getAllKeys: () => request([...pictures.keys()]),
};

(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => backing[key] ?? null,
    setItem: (key: string, value: string) => {
      backing[key] = value;
    },
    removeItem: (key: string) => {
      delete backing[key];
    },
  },
  addEventListener() {},
  removeEventListener() {},
};
(globalThis as unknown as { document: unknown }).document = { cookie: "" };
(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () =>
    request({
      onclose: null,
      objectStoreNames: { contains: () => true },
      createObjectStore: () => objectStore,
      transaction: () => ({ objectStore: () => objectStore }),
    }),
};

const { applyProfile, hasLocalProfile } = await import("./profile-backup.ts");
const { setDisplayName } = await import("./local-profile.ts");

test("a browser with nothing of its own says so", async () => {
  assert.equal(await hasLocalProfile(), false);
});

test("a picture with no thumbnail beside it is still a picture", async () => {
  pictures.set("avatar", { size: 76208 });
  assert.equal(await hasLocalProfile(), true);
  assert.equal(backing["timbre:thumb-avatar"], undefined, "and no thumbnail was consulted");
});

test("a banner counts as much as an avatar", async () => {
  pictures.delete("avatar");
  pictures.set("banner", { size: 12 });
  assert.equal(await hasLocalProfile(), true);
});

test("a display name alone is a profile", async () => {
  pictures.clear();
  assert.equal(await hasLocalProfile(), false);

  setDisplayName("Ren");
  assert.equal(await hasLocalProfile(), true);
});

test("an imported name this browser cannot store is not reported as applied", async () => {
  // `applyProfile` returns the fields it set, and library-view.tsx reads that list out to the
  // reader. It used to push "name" on the strength of having called `setDisplayName`, which
  // said nothing about whether the write landed — so a full localStorage was told its profile
  // had been replaced by a name that is stored nowhere.
  const real = window.localStorage.setItem;
  window.localStorage.setItem = () => {
    throw new DOMException("out of room", "QuotaExceededError");
  };

  const applied = await applyProfile({ name: "Imported", avatar: null, banner: null });
  window.localStorage.setItem = real;

  assert.deepEqual(applied, []);
  assert.notEqual(backing["timbre:profile-name"], "Imported");
});
