"use client";

/**
 * A profile picture and banner, kept in the browser.
 *
 * **Nothing is uploaded.** The file never leaves the machine it was chosen on:
 * it is resized on a canvas and written to IndexedDB. Timbre stores no image,
 * which keeps "it hosts nothing" true of pictures as well as audio, and means a
 * profile picture involves no upload endpoint, no storage bill, no moderation
 * question and no way for a bad file to reach anyone else.
 *
 * **IndexedDB rather than localStorage, and the reason is arithmetic.**
 * localStorage is one ~5MB pool for the whole origin, shared with playlists,
 * the queue and history — and it stores strings, so an image has to be base64,
 * which inflates it by a third. Two pictures could take most of the budget and
 * start failing playlist saves, which is a silly way to lose a playlist.
 * IndexedDB holds Blobs at their real size and is measured in hundreds of
 * megabytes. Playlists stay in localStorage, where being small and synchronous
 * is worth more than being roomy.
 *
 * The cost is honest and stated in the UI: pictures are per-device. Signing in
 * on a phone shows the derived avatar, because the phone has never seen the
 * file.
 */

import { useEffect, useSyncExternalStore } from "react";

export type ImageKind = "avatar" | "banner";

export interface LocalImages {
  /** False until IndexedDB has answered, so "none" and "not yet" differ. */
  loaded: boolean;
  avatar: string | null;
  banner: string | null;
}

/**
 * Target sizes. Small enough to stay cheap, large enough not to look soft on a
 * retina screen at the size each is actually drawn.
 */
const SIZES: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1600, height: 500 },
};

/** Refused outright. SVG can carry script, and nothing here needs vectors. */
const REJECTED = new Set(["image/svg+xml"]);

/** Guard before decoding — a malformed huge file should fail fast and cheap. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

const DB_NAME = "timbre";
const DB_VERSION = 1;
const STORE = "images";

const EMPTY: LocalImages = { loaded: false, avatar: null, banner: null };

let snapshot: LocalImages = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * The key is the kind, and nothing else.
 *
 * It used to be `<userId>:<kind>`, which was right when accounts existed and
 * two people could share a browser. They cannot any more: there is one profile
 * per browser and its id is generated locally. Keeping the id in the key made
 * the pictures **unreachable the moment that id changed** — which is exactly
 * what happened when accounts were removed and every id was regenerated.
 *
 * A fixed key cannot drift, and the id stays what it should always have been:
 * a seed for the avatar's colour.
 */
function keyFor(kind: ImageKind): string {
  return kind;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/**
 * Object URLs are revoked as they are replaced.
 *
 * Each one pins its Blob in memory until released, so a profile that swaps
 * pictures a few times would otherwise hold every previous version for the
 * life of the tab.
 */
function replaceUrl(previous: string | null, blob: Blob | null): string | null {
  if (previous) URL.revokeObjectURL(previous);
  return blob ? URL.createObjectURL(blob) : null;
}

/**
 * Adopts pictures left behind by earlier versions.
 *
 * Two generations of orphan exist and both are recoverable, so both are looked
 * for rather than written off:
 *
 * 1. **localStorage data URLs** keyed `timbre:profile:<kind>:<userId>` — from
 *    before pictures moved to IndexedDB.
 * 2. **IndexedDB blobs** keyed `<userId>:<kind>` — from before the id came out
 *    of the key. These are the ones stranded by removing accounts, because
 *    every profile id was regenerated at that moment.
 *
 * Any user id matches. There is only one person per browser now, so a picture
 * found under *some* id is unambiguously theirs.
 */
async function adoptOrphans(): Promise<void> {
  for (const kind of ["avatar", "banner"] as const) {
    // Already migrated — nothing to look for.
    const existing = await run<Blob | undefined>("readonly", (store) => store.get(keyFor(kind)));
    if (existing) continue;

    // Generation 2: a composite IndexedDB key from any id.
    const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    const composite = keys.find(
      (key) => typeof key === "string" && key.endsWith(`:${kind}`),
    );
    if (typeof composite === "string") {
      const blob = await run<Blob | undefined>("readonly", (store) => store.get(composite));
      if (blob) {
        await run("readwrite", (store) => store.put(blob, keyFor(kind)));
        await run("readwrite", (store) => store.delete(composite));
        continue;
      }
    }

    // Generation 1: a localStorage data URL under any id.
    try {
      const legacy = Object.keys(window.localStorage).find((key) =>
        key.startsWith(`timbre:profile:${kind}:`),
      );
      if (!legacy) continue;

      const dataUrl = window.localStorage.getItem(legacy);
      if (!dataUrl) continue;

      const blob = await (await fetch(dataUrl)).blob();
      await run("readwrite", (store) => store.put(blob, keyFor(kind)));
      window.localStorage.removeItem(legacy);
    } catch {
      // Leave the old value alone rather than dropping a picture that could
      // not be converted; it will be retried on the next load.
    }
  }
}

/** Reads both pictures once. Concurrent callers share the same attempt. */
function load(): Promise<void> {
  if (loading) return loading;
  if (snapshot.loaded) return Promise.resolve();

  loading = (async () => {
    try {
      await adoptOrphans();
      const [avatar, banner] = await Promise.all([
        run<Blob | undefined>("readonly", (store) => store.get(keyFor("avatar"))),
        run<Blob | undefined>("readonly", (store) => store.get(keyFor("banner"))),
      ]);

      snapshot = {
        loaded: true,
        avatar: replaceUrl(snapshot.avatar, avatar ?? null),
        banner: replaceUrl(snapshot.banner, banner ?? null),
      };
    } catch {
      // Private browsing blocks IndexedDB entirely. The derived avatar is the
      // correct fallback, and the picker reports a failure if one is chosen.
      snapshot = { loaded: true, avatar: null, banner: null };
    } finally {
      loading = null;
      emit();
    }
  })();

  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LocalImages {
  return snapshot;
}

function getServerSnapshot(): LocalImages {
  return EMPTY;
}

/**
 * This user's local pictures.
 *
 * Empty until IndexedDB answers, which is asynchronous — so the derived avatar
 * is always what renders first, on the server and on the client alike, and
 * there is no markup for hydration to disagree about.
 */
export function useLocalImages(): LocalImages {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void load();
  }, []);

  return current;
}

export class ImageTooLargeError extends Error {
  constructor(message = "That picture is too large for this browser to keep.") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

/**
 * Redraws a chosen file at the target size, cropped to fill.
 *
 * Cover rather than contain: a banner letterboxed inside its own box would show
 * bars in the page's colour, which reads as a broken image. The excess is
 * cropped centrally, which is what every profile editor does.
 *
 * Encoded straight to a Blob rather than a data URL — the base64 step existed
 * only because localStorage cannot hold binary, and it inflated every picture
 * by a third for nothing.
 */
async function redraw(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError();
  if (REJECTED.has(file.type) || !file.type.startsWith("image/")) {
    throw new Error("That file isn't an image Timbre can use.");
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = SIZES[kind];

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't process images.");

    // Cover: scale by the larger ratio, then centre the overflow.
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;

    context.drawImage(
      bitmap,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      // WebP where the browser will encode it. Browsers that cannot silently
      // hand back a PNG instead of failing, so the type is checked afterwards
      // rather than assumed.
      canvas.toBlob((result) => resolve(result), "image/webp", 0.82);
    });

    if (blob && blob.type === "image/webp") return blob;

    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.85);
    });

    if (!jpeg) throw new Error("This browser couldn't encode that picture.");
    return jpeg;
  } finally {
    // Frees the decoded frame immediately rather than at the next collection.
    bitmap.close();
  }
}

/** Resizes and stores a picture on this device. */
export async function setLocalImage(kind: ImageKind, file: File): Promise<void> {
  const blob = await redraw(file, kind);

  try {
    await run("readwrite", (store) => store.put(blob, keyFor(kind)));
  } catch (cause) {
    // QuotaExceededError is the only realistic failure and is worth naming:
    // silently keeping the old picture looks like the choice did not register.
    throw new ImageTooLargeError(
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "This browser is out of storage. Remove a picture or some playlists."
        : "Couldn't save that picture in this browser.",
    );
  }

  snapshot = {
    loaded: true,
    avatar: kind === "avatar" ? replaceUrl(snapshot.avatar, blob) : snapshot.avatar,
    banner: kind === "banner" ? replaceUrl(snapshot.banner, blob) : snapshot.banner,
  };
  emit();
}

/** Forgets a picture, falling the profile back to its derived appearance. */
export function clearLocalImage(kind: ImageKind): void {
  snapshot = {
    loaded: true,
    avatar: kind === "avatar" ? replaceUrl(snapshot.avatar, null) : snapshot.avatar,
    banner: kind === "banner" ? replaceUrl(snapshot.banner, null) : snapshot.banner,
  };
  emit();

  // The record is removed after the view has already updated: waiting on a
  // database round trip to make a removal appear would feel broken.
  void run("readwrite", (store) => store.delete(keyFor(kind))).catch(() => {
    // Nothing stored means nothing to remove.
  });
}
