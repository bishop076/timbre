"use client";

import { useEffect, useSyncExternalStore } from "react";

import { createNotifier } from "../local-store.ts";

export type ImageKind = "avatar" | "banner";

export interface LocalImages {
  loaded: boolean;
  avatar: string | null;
  banner: string | null;
}

const DB_NAME = "timbre";
const DB_VERSION = 1;

const STORE = "images";

const EMPTY: LocalImages = { loaded: false, avatar: null, banner: null };

let snapshot: LocalImages = EMPTY;
let loading: Promise<void> | null = null;
const { emit, subscribe } = createNotifier(onStorage);

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

function replaceUrl(previous: string | null, blob: Blob | null): string | null {
  if (previous) URL.revokeObjectURL(previous);
  return blob ? URL.createObjectURL(blob) : null;
}

async function decoded(url: string | null): Promise<void> {
  if (!url) return;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch {
  }
}

function load(): Promise<void> {
  if (loading) return loading;
  if (snapshot.loaded) return Promise.resolve();

  loading = (async () => {
    try {
      const [avatar, banner] = await Promise.all([
        run<Blob | undefined>("readonly", (store) => store.get("avatar")),
        run<Blob | undefined>("readonly", (store) => store.get("banner")),
      ]);

      const nextAvatar = avatar ? URL.createObjectURL(avatar) : null;
      const nextBanner = banner ? URL.createObjectURL(banner) : null;
      await Promise.all([decoded(nextAvatar), decoded(nextBanner)]);

      if (snapshot.avatar) URL.revokeObjectURL(snapshot.avatar);
      if (snapshot.banner) URL.revokeObjectURL(snapshot.banner);

      snapshot = { loaded: true, avatar: nextAvatar, banner: nextBanner };

      const stale = !thumbsAreCurrent();
      for (const [kind, blob] of [
        ["avatar", avatar],
        ["banner", banner],
      ] as const) {
        if (blob && (stale || !readThumb(kind))) void writeThumb(kind, blob);
      }
    } catch {
      snapshot = { ...snapshot, loaded: true };
    } finally {
      loading = null;
      emit();
    }
  })();

  return loading;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== THUMB_KEY.avatar && event.key !== THUMB_KEY.banner) return;

  const reload = () => {
    snapshot = { ...snapshot, loaded: false };
    return load();
  };
  void (loading ? loading.then(reload) : reload());
}

const THUMB_KEY: Record<ImageKind, string> = {
  avatar: "timbre:thumb-avatar",
  banner: "timbre:thumb-banner",
};

const THUMB_SIZE: Record<ImageKind, number> = { avatar: 384, banner: 768 };

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
    return raw?.startsWith("data:image/") ? raw : null;
  } catch {
    return null;
  }
}

let thumbed = false;

function getSnapshot(): LocalImages {
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

export function useLocalImages(): LocalImages {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void load();
  }, []);

  return current;
}

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

    let encoded = canvas.toDataURL("image/webp", 0.7);
    if (!encoded.startsWith("data:image/webp")) {
      encoded = canvas.toDataURL("image/jpeg", 0.72);
    }

    window.localStorage.setItem(THUMB_KEY[kind], encoded);
    window.localStorage.setItem(THUMB_VERSION_KEY, THUMB_VERSION);
    paintThumbVariables(kind);
  } catch {
  }
}

function dropThumb(kind: ImageKind): void {
  try {
    window.localStorage.removeItem(THUMB_KEY[kind]);
  } catch {
  }
  paintThumbVariables(kind);
}

function paintThumbVariables(kind: ImageKind): void {
  const root = document.documentElement;
  const thumb = readThumb(kind);
  const url = thumb ? `url(${JSON.stringify(thumb)})` : null;

  if (kind === "banner") {
    if (url) root.style.setProperty("--banner-thumb", url);
    else root.style.removeProperty("--banner-thumb");
    return;
  }

  if (url) {
    root.style.setProperty("--avatar-thumb", url);
    root.style.setProperty("--avatar-letter", "0");
  } else {
    root.style.removeProperty("--avatar-thumb");
    root.style.removeProperty("--avatar-letter");
  }
}

export async function setLocalImage(kind: ImageKind, file: File): Promise<void> {
  const { redraw, ImageTooLargeError } = await import("./image-resize");

  const blob = await redraw(file, kind);
  await writeThumb(kind, blob);

  try {
    await run("readwrite", (store) => store.put(blob, kind));
  } catch (cause) {
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

export async function readLocalImage(kind: ImageKind): Promise<Blob | null> {
  try {
    return (await run<Blob | undefined>("readonly", (store) => store.get(kind))) ?? null;
  } catch {
    return null;
  }
}

export function hasLocalImage(kind: ImageKind): boolean {
  return readThumb(kind) !== null;
}

export function clearLocalImage(kind: ImageKind): void {
  dropThumb(kind);

  snapshot = {
    loaded: true,
    avatar: kind === "avatar" ? replaceUrl(snapshot.avatar, null) : snapshot.avatar,
    banner: kind === "banner" ? replaceUrl(snapshot.banner, null) : snapshot.banner,
  };
  emit();

  void run("readwrite", (store) => store.delete(kind)).catch(() => {
  });
}
