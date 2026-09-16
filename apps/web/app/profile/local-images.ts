"use client";

import { useEffect, useSyncExternalStore } from "react";

import { isReplayableImage } from "../customise/replay.ts";
import { createNotifier, readItem, writeItem } from "../local-store.ts";
import { log } from "../logs.ts";
import { openImageStore } from "./image-store.ts";

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export type ImageKind = "avatar" | "banner";

interface LocalImages {
  loaded: boolean;
  avatar: string | null;
  banner: string | null;
}

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
const { emit, subscribe } = createNotifier(onStorage);

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return openImageStore(mode, work);
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

/**
 * The stored thumbnail, but only if it is the kind of value the pre-paint script would also
 * have replayed.
 *
 * This used to be `raw?.startsWith("data:image/")`, which is a check on the first eleven
 * characters of a string whose *last* characters are the dangerous ones. It let through
 * `data:image/svg+xml;…` — an SVG is a document, not a raster — and, worse, anything at all
 * after the prefix, including a `") , url("`. That matters because this value is spliced into
 * CSS twice: `paintThumbVariables` puts it in `--avatar-thumb`, and `<Avatar>` puts it in a
 * `background-image`. A planted `data:image/png;base64,AA") , url("https://…` closed the first
 * `url()` and opened a second, so a string in localStorage became an outbound request that
 * fires before paint on every load, with nothing in the UI to notice it.
 *
 * `isReplayableImage` is the rule the boot script in layout.tsx already enforces, and sharing
 * it is the point: the hydrated path was accepting values the pre-paint path refused, which is
 * precisely the divergence that makes a hardened boot script stop being worth anything.
 */
function readThumb(kind: ImageKind): string | null {
  const raw = readItem(THUMB_KEY[kind]);
  return isReplayableImage(raw) ? raw : null;
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
  let stored = false;
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
    stored = true;
    window.localStorage.setItem(THUMB_VERSION_KEY, THUMB_VERSION);
    paintThumbVariables(kind);
  } catch (cause) {
    // Swallowed silently before, including the `QuotaExceededError` this is most likely to
    // throw. The picture itself is safe in IndexedDB by the time this runs; what is lost is
    // the pre-hydration painting, so the name and avatar flash in on load instead of being
    // there. Worth saying out loud, not worth failing the save over.
    //
    // And the thumbnail beside it goes, because it is now a picture of nothing: it was drawn
    // from the picture this one replaced. Leaving it there meant every later load painted the
    // *old* face before first paint and swapped to the new one once IndexedDB answered — and
    // it never repaired itself, because `load()` only redraws a thumbnail when there is none.
    // Dropping it costs one frame of monogram and makes the next load put the right one back.
    //
    // Only when the new one did not land. A thumbnail that stored and then failed on the tiny
    // version marker beside it is still a picture of the picture, and throwing it away would
    // cost the pre-paint frame for nothing.
    if (!stored) dropThumb(kind);
    log("warn", `Profile ${kind}: the thumbnail could not be stored — ${describe(cause)}`);
  }
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

  // IndexedDB first, because it holds the picture and the thumbnail is only a painting of it.
  // The other way round, a failed put ran `dropThumb`, which removed the thumbnail belonging
  // to the picture the reader still had and had not replaced, so "Remove picture" disappeared
  // until the next full page load regenerated it. A failed save now changes nothing at all.
  // Nothing asks the thumbnail whether a picture exists any more either — `hasLocalProfile()`
  // asks IndexedDB, because a thumbnail can be refused while the picture beside it is safe.
  try {
    await run("readwrite", (store) => store.put(blob, kind));
  } catch (cause) {
    throw new Error(
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "This browser is out of storage. Remove a picture or some playlists."
        : "Couldn't save that picture in this browser.",
    );
  }

  await writeThumb(kind, blob);
  publish(kind, blob);
}

export async function readLocalImage(kind: ImageKind): Promise<Blob | null> {
  try {
    return (await run<Blob | undefined>("readonly", (store) => store.get(kind))) ?? null;
  } catch {
    return null;
  }
}

export function clearLocalImage(kind: ImageKind): void {
  dropThumb(kind);
  publish(kind);
  void run("readwrite", (store) => store.delete(kind)).catch(() => {});
}
