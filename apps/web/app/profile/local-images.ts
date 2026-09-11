"use client";

import { useEffect, useSyncExternalStore } from "react";

import { createNotifier, readItem, writeItem } from "../local-store.ts";

export type ImageKind = "avatar" | "banner";

interface LocalImages {
  loaded: boolean;
  avatar: string | null;
  banner: string | null;
}

const STORE = "images";
const THUMB_KEY: Record<ImageKind, string> = {
  avatar: "timbre:thumb-avatar",
  banner: "timbre:thumb-banner",
};
const THUMB_SIZE: Record<ImageKind, number> = { avatar: 384, banner: 768 };
const THUMB_VERSION = "2";
const THUMB_VERSION_KEY = "timbre:thumb-version";

const EMPTY: LocalImages = { loaded: false, avatar: null, banner: null };

let snapshot: LocalImages = EMPTY;
let loading: Promise<void> | null = null;
let thumbed = false;
let connection: Promise<IDBDatabase> | null = null;
const { emit, subscribe } = createNotifier(onStorage);

function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("timbre", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      request.result.onclose = () => {
        connection = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch((cause: unknown) => {
    connection = null;
    throw cause;
  });
  return connection;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function objectUrl(blob: Blob | undefined): string | null {
  return blob ? URL.createObjectURL(blob) : null;
}

async function decoded(url: string | null): Promise<void> {
  if (!url) return;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch {}
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

      const next = { loaded: true, avatar: objectUrl(avatar), banner: objectUrl(banner) };
      await Promise.all([decoded(next.avatar), decoded(next.banner)]);

      if (snapshot.avatar) URL.revokeObjectURL(snapshot.avatar);
      if (snapshot.banner) URL.revokeObjectURL(snapshot.banner);
      snapshot = next;

      const stale = readItem(THUMB_VERSION_KEY) !== THUMB_VERSION;
      if (avatar && (stale || !readThumb("avatar"))) void writeThumb("avatar", avatar);
      if (banner && (stale || !readThumb("banner"))) void writeThumb("banner", banner);
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

function readThumb(kind: ImageKind): string | null {
  const raw = readItem(THUMB_KEY[kind]);
  return raw?.startsWith("data:image/") ? raw : null;
}

function getSnapshot(): LocalImages {
  if (!thumbed) {
    thumbed = true;
    const avatar = readThumb("avatar");
    const banner = readThumb("banner");
    if (avatar || banner) snapshot = { ...snapshot, avatar, banner };
  }
  return snapshot;
}

export function useLocalImages(): LocalImages {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

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

    const webp = canvas.toDataURL("image/webp", 0.7);
    const encoded = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.72);

    window.localStorage.setItem(THUMB_KEY[kind], encoded);
    window.localStorage.setItem(THUMB_VERSION_KEY, THUMB_VERSION);
    paintThumbVariables(kind);
  } catch {}
}

function dropThumb(kind: ImageKind): void {
  writeItem(THUMB_KEY[kind], null);
  paintThumbVariables(kind);
}

function paintThumbVariables(kind: ImageKind): void {
  const { style } = document.documentElement;
  const thumb = readThumb(kind);
  const url = thumb ? `url(${JSON.stringify(thumb)})` : null;
  if (kind === "banner") {
    if (url) style.setProperty("--banner-thumb", url);
    else style.removeProperty("--banner-thumb");
  } else if (url) {
    style.setProperty("--avatar-thumb", url);
    style.setProperty("--avatar-letter", "0");
  } else {
    style.removeProperty("--avatar-thumb");
    style.removeProperty("--avatar-letter");
  }
}

function publish(kind: ImageKind, blob?: Blob): void {
  const previous = snapshot[kind];
  if (previous) URL.revokeObjectURL(previous);
  snapshot = { ...snapshot, loaded: true, [kind]: objectUrl(blob) };
  emit();
}

export async function setLocalImage(kind: ImageKind, file: File): Promise<void> {
  const { redraw } = await import("./image-resize");

  const blob = await redraw(file, kind);
  await writeThumb(kind, blob);

  try {
    await run("readwrite", (store) => store.put(blob, kind));
  } catch (cause) {
    dropThumb(kind);
    throw new Error(
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "This browser is out of storage. Remove a picture or some playlists."
        : "Couldn't save that picture in this browser.",
    );
  }

  publish(kind, blob);
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
  publish(kind);
  void run("readwrite", (store) => store.delete(kind)).catch(() => {});
}
