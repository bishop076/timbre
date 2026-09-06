"use client";

// A profile picture and banner, kept in this browser. IndexedDB, not localStorage: that
// is one ~5MB string pool for the whole origin, where a base64 picture would start
// failing playlist saves. Pictures are per-device as a result.

import { useEffect, useSyncExternalStore } from "react";

import { createNotifier } from "../local-store.ts";

export type ImageKind = "avatar" | "banner";

export interface LocalImages {
  /** False until IndexedDB has answered, so "none" and "not yet" differ. */
  loaded: boolean;
  avatar: string | null;
  banner: string | null;
}

const DB_NAME = "timbre";
const DB_VERSION = 1;

// Keyed by the kind alone, never `<userId>:<kind>`: the profile id is generated locally and
// regenerates, and an id in the key made every picture unreachable when it changed.
const STORE = "images";

const EMPTY: LocalImages = { loaded: false, avatar: null, banner: null };

let snapshot: LocalImages = EMPTY;
let loading: Promise<void> | null = null;
const { emit, subscribe } = createNotifier(onStorage);

// One connection, reused: open connections block a version upgrade, so a `DB_VERSION`
// bump would hang against handles nothing can close. Eviction closes it and drops the
// cache, so the next call reopens.
let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((cause: unknown) => {
    connection = null;
    throw cause;
  });

  return connection;
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

/** Swaps object URLs, revoking the old — each pins its Blob until released. */
function replaceUrl(previous: string | null, blob: Blob | null): string | null {
  if (previous) URL.revokeObjectURL(previous);
  return blob ? URL.createObjectURL(blob) : null;
}

// Waits for a picture to decode before anything draws it — this is what stops the avatar
// flickering. The thumbnail paints first, then IndexedDB answers with a freshly minted
// `blob:`, a *different* URL, so the browser paints its own grey until that one decodes.
async function decoded(url: string | null): Promise<void> {
  if (!url) return;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch {
    // Not decodable, or the browser lacks `decode()`. Publish regardless.
  }
}

/** Reads both pictures once. Concurrent callers share the same attempt. */
function load(): Promise<void> {
  if (loading) return loading;
  if (snapshot.loaded) return Promise.resolve();

  loading = (async () => {
    try {
      const [avatar, banner] = await Promise.all([
        run<Blob | undefined>("readonly", (store) => store.get("avatar")),
        run<Blob | undefined>("readonly", (store) => store.get("banner")),
      ]);

      // Decoded before publishing — publishing first produced the flicker.
      const nextAvatar = avatar ? URL.createObjectURL(avatar) : null;
      const nextBanner = banner ? URL.createObjectURL(banner) : null;
      await Promise.all([decoded(nextAvatar), decoded(nextBanner)]);

      if (snapshot.avatar) URL.revokeObjectURL(snapshot.avatar);
      if (snapshot.banner) URL.revokeObjectURL(snapshot.banner);

      snapshot = { loaded: true, avatar: nextAvatar, banner: nextBanner };

      // Backfilled so a size change reaches browsers that already hold a picture.
      const stale = !thumbsAreCurrent();
      for (const [kind, blob] of [
        ["avatar", avatar],
        ["banner", banner],
      ] as const) {
        if (blob && (stale || !readThumb(kind))) void writeThumb(kind, blob);
      }
    } catch {
      // Private browsing blocks IndexedDB. The thumbnails are kept, not discarded:
      // they came from `localStorage`, and dropping them downgrades to a monogram.
      snapshot = { ...snapshot, loaded: true };
    } finally {
      loading = null;
      emit();
    }
  })();

  return loading;
}

// Another tab changed a picture; re-read rather than diverging. IndexedDB fires no
// cross-document event, so the thumbnail is the fast copy *and* the notification.
function onStorage(event: StorageEvent): void {
  if (event.key !== THUMB_KEY.avatar && event.key !== THUMB_KEY.banner) return;

  // `load()` returns early once settled, so the flag has to come down first. And it hands
  // back the read already in flight rather than starting another, so a change that lands
  // mid-load has to wait for that read to finish and then ask again — or the picture the
  // other tab just chose is lost until a reload, replaced by the one read before it.
  const reload = () => {
    snapshot = { ...snapshot, loaded: false };
    return load();
  };
  void (loading ? loading.then(reload) : reload());
}

// A small copy of each picture, read on the first render — IndexedDB cannot be, so the
// first paint otherwise drew the monogram and replaced it a moment later. Not the whole
// file: base64 of a 5MB animated GIF would exceed the storage quota on its own.
const THUMB_KEY: Record<ImageKind, string> = {
  avatar: "timbre:thumb-avatar",
  banner: "timbre:thumb-banner",
};

// Measured from where the picture is actually drawn: 384 covers the profile header's
// 192px avatar at 2× and a phone's 128px one at 3×, where the old 96px was visibly mushy.
// 768 is a compromise for the banner — enough for a blurred backdrop, without a megabyte
// of base64 in the 5MB pool shared with every playlist.
const THUMB_SIZE: Record<ImageKind, number> = { avatar: 384, banner: 768 };

// Bumped whenever `THUMB_SIZE` or the encoding changes: the backfill writes only when a
// thumbnail is *missing*, so without a mismatch to detect, a size change would reach
// nobody who already has one.
const THUMB_VERSION = "2";
const THUMB_VERSION_KEY = "timbre:thumb-version";

function thumbsAreCurrent(): boolean {
  try {
    return window.localStorage.getItem(THUMB_VERSION_KEY) === THUMB_VERSION;
  } catch {
    return true;
  }
}

function readThumb(kind: ImageKind): string | null {
  try {
    const raw = window.localStorage.getItem(THUMB_KEY[kind]);
    // User-editable storage: anything that is not a data URL never reaches `src`.
    return raw?.startsWith("data:image/") ? raw : null;
  } catch {
    return null;
  }
}

let thumbed = false;

function getSnapshot(): LocalImages {
  // `loaded` stays false: IndexedDB has still not answered, which is the question.
  if (!thumbed) {
    thumbed = true;
    const avatar = readThumb("avatar");
    const banner = readThumb("banner");
    if (avatar || banner) snapshot = { ...snapshot, avatar, banner };
  }
  return snapshot;
}

function getServerSnapshot(): LocalImages {
  return EMPTY;
}

/** This user's local pictures. Empty until IndexedDB answers. */
export function useLocalImages(): LocalImages {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void load();
  }, []);

  return current;
}

/** Writes the small synchronous copy. Failure costs only the optimisation. */
async function writeThumb(kind: ImageKind, blob: Blob): Promise<void> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_SIZE[kind] / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // `toDataURL` silently hands back a PNG for a type it cannot encode, which at
    // these sizes is hundreds of kilobytes — so the type is checked, not assumed.
    let encoded = canvas.toDataURL("image/webp", 0.7);
    if (!encoded.startsWith("data:image/webp")) {
      encoded = canvas.toDataURL("image/jpeg", 0.72);
    }

    window.localStorage.setItem(THUMB_KEY[kind], encoded);
    window.localStorage.setItem(THUMB_VERSION_KEY, THUMB_VERSION);
    if (kind === "avatar") paintAvatarVariables();
  } catch {
    // Quota, an unsupported encoder, or an undecodable blob.
  }
}

/** Forgets the small copy, and the first-paint variables that quote it. */
function dropThumb(kind: ImageKind): void {
  try {
    window.localStorage.removeItem(THUMB_KEY[kind]);
  } catch {
    // Storage unavailable; there was nothing to leave behind either.
  }
  if (kind === "avatar") paintAvatarVariables();
}

// Keeps `<html>`'s avatar variables in step with the thumbnail. The boot script sets them
// once and nothing else did, so a removed picture left a stale `url(…)` of a deleted
// photograph on the document.
function paintAvatarVariables(): void {
  const root = document.documentElement;
  const thumb = readThumb("avatar");

  if (thumb) {
    root.style.setProperty("--avatar-thumb", `url("${thumb}")`);
    root.style.setProperty("--avatar-letter", "0");
  } else {
    root.style.removeProperty("--avatar-thumb");
    root.style.removeProperty("--avatar-letter");
  }
}

/** Resizes and stores a picture on this device. */
export async function setLocalImage(kind: ImageKind, file: File): Promise<void> {
  // Dynamic: this module is in every route's bundle, the canvas path is not.
  const { redraw, ImageTooLargeError } = await import("./image-resize");

  const blob = await redraw(file, kind);
  await writeThumb(kind, blob);

  try {
    await run("readwrite", (store) => store.put(blob, kind));
  } catch (cause) {
    // Rolled back: the thumbnail is written first, so a failed save would leave a small
    // copy of a picture that was never stored — painted on the next load, then taken away
    // the moment IndexedDB answers with nothing.
    dropThumb(kind);

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
  // First: a thumbnail left behind is re-read and the picture comes back for a frame.
  dropThumb(kind);

  snapshot = {
    loaded: true,
    avatar: kind === "avatar" ? replaceUrl(snapshot.avatar, null) : snapshot.avatar,
    banner: kind === "banner" ? replaceUrl(snapshot.banner, null) : snapshot.banner,
  };
  emit();

  void run("readwrite", (store) => store.delete(kind)).catch(() => {
    // Nothing stored means nothing to remove.
  });
}
