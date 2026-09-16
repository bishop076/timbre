/**
 * The thumbnail beside a profile picture, and what happens to it when `localStorage` is full.
 *
 * The picture lives in IndexedDB; the thumbnail in `localStorage` is a small painting of it, and
 * the only form the pre-paint script in layout.tsx can put on screen before React is up. The two
 * can be refused independently, and a thumbnail that survives a picture it no longer depicts is
 * a picture of the wrong thing on every load from then on.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const backing: Record<string, string> = {};
const pictures = new Map<string, { size: number; type: string }>();
const painted: Record<string, string> = {};
let writable = true;

/** The data URL a canvas of `size` pretends to encode. Base64, so `isReplayableImage` takes it. */
const encoded = (size: number) => `data:image/webp;base64,${"A".repeat(size)}`;
let thumbChars = 40;

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

const objectStore = {
  get: (key: string) => request(pictures.get(key)),
  put: (value: { size: number; type: string }, key: string) => {
    pictures.set(key, value);
    return request(undefined);
  },
  delete: (key: string) => {
    pictures.delete(key);
    return request(undefined);
  },
};

const canvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({ drawImage() {}, imageSmoothingQuality: "" }),
  toDataURL: () => encoded(thumbChars),
  toBlob: (done: (blob: unknown) => void, type: string) =>
    queueMicrotask(() => done({ size: thumbChars * 4, type })),
});

(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => backing[key] ?? null,
    setItem: (key: string, value: string) => {
      if (!writable) throw new DOMException("out of room", "QuotaExceededError");
      backing[key] = value;
    },
    removeItem: (key: string) => {
      delete backing[key];
    },
  },
  addEventListener() {},
  removeEventListener() {},
};
(globalThis as unknown as { document: unknown }).document = {
  documentElement: {
    style: {
      setProperty: (name: string, value: string) => {
        painted[name] = value;
      },
      removeProperty: (name: string) => {
        delete painted[name];
      },
    },
  },
  createElement: () => canvas(),
};
(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
  open: () =>
    request({
      onclose: null,
      objectStoreNames: { contains: () => true },
      createObjectStore: () => objectStore,
      transaction: () => ({ objectStore: () => objectStore }),
    }),
};
(globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = () =>
  Promise.resolve({ width: 512, height: 512, close() {} });
(globalThis as unknown as { URL: { createObjectURL: unknown; revokeObjectURL: unknown } }).URL =
  Object.assign(URL, {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });

const { setLocalImage } = await import("./local-images.ts");

const AVATAR_THUMB = "timbre:thumb-avatar";
const picture = (name: string) =>
  ({ name, type: "image/png", size: 4096 }) as unknown as File;

test("the first picture stores a thumbnail beside it", async () => {
  thumbChars = 40;
  await setLocalImage("avatar", picture("one.png"));

  assert.equal(pictures.get("avatar")?.size, 160);
  assert.equal(backing[AVATAR_THUMB], encoded(40));
  assert.equal(painted["--avatar-thumb"], `url(${JSON.stringify(encoded(40))})`);
});

test("a thumbnail this browser refuses does not leave the old one standing", async () => {
  // The whole finding: the picture landed in IndexedDB, the thumbnail did not, and what stayed
  // in localStorage was the *previous* picture — so every later load painted the face the reader
  // had just replaced, before the first frame, and never repaired itself, because `load()` only
  // redraws a thumbnail when there is none.
  writable = false;
  thumbChars = 4000;
  await setLocalImage("avatar", picture("two.png"));
  writable = true;

  assert.equal(pictures.get("avatar")?.size, 16000, "the new picture is safe in IndexedDB");
  assert.equal(backing[AVATAR_THUMB], undefined, "and the old thumbnail went with it");
  assert.equal(painted["--avatar-thumb"], undefined, "so nothing is replayed before paint");
});

test("and the next save that fits puts a thumbnail back", async () => {
  thumbChars = 60;
  await setLocalImage("avatar", picture("three.png"));

  assert.equal(backing[AVATAR_THUMB], encoded(60));
  assert.equal(painted["--avatar-thumb"], `url(${JSON.stringify(encoded(60))})`);
});

test("a thumbnail that stored is kept even if the version marker beside it could not be", async () => {
  // Two writes, and only the second one is allowed to fail: the thumbnail is current, and
  // throwing it away would cost the pre-paint frame for nothing.
  delete backing["timbre:thumb-version"];
  thumbChars = 80;
  let writes = 0;
  const real = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage
    .setItem;
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem = (
    key: string,
    value: string,
  ) => {
    if (++writes === 2) throw new DOMException("out of room", "QuotaExceededError");
    backing[key] = value;
  };

  await setLocalImage("avatar", picture("four.png"));
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem =
    real;

  assert.equal(backing[AVATAR_THUMB], encoded(80));
});
