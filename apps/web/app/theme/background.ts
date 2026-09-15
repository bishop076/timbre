"use client";

/**
 * A picture of the reader's own behind the app.
 *
 * Local files only. A remote URL would mean the app fetching an arbitrary origin on every page
 * load, leaking where the reader is to whoever hosts it, and breaking the moment that host goes
 * away — for a decoration. A file is chosen once, redrawn here, and kept in this browser.
 *
 * Two copies are kept, for the same reason the profile pictures keep two: the full-size one in
 * IndexedDB, which is what is actually shown, and a small data URL in localStorage, which is
 * the only form the pre-paint script in layout.tsx can replay. Without the second, a reader
 * with a background sees the flat theme for one frame on every single load.
 */

import { createNotifier, readItem, writeItem } from "../local-store.ts";
import { openImageStore } from "../profile/image-store.ts";
import { backgroundVars, type BackgroundPrefs } from "./custom-theme.ts";
import { setFlag, setVars } from "./theme-css.ts";

const KEY = "theme-bg";
export const THUMB_KEY = "timbre:theme-bg";

export const ACCEPT = "image/png,image/jpeg,image/webp,image/avif";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const FULL = { width: 1920, height: 1200 };
const THUMB = 512;

const { emit, subscribe } = createNotifier(onStorage);

let objectUrl: string | null = null;
let snapshot: string | null = null;
let read = false;

function onStorage(event: StorageEvent): void {
  if (event.key !== THUMB_KEY) return;
  read = false;
  void load();
}

function thumb(): string | null {
  const raw = readItem(THUMB_KEY);
  return raw?.startsWith("data:image/") ? raw : null;
}

/** The URL of the background, or null. The thumbnail first, the full picture once it is read. */
export function getBackground(): string | null {
  if (!read) {
    read = true;
    snapshot = thumb();
    void load();
  }
  return snapshot;
}

export const subscribeBackground = subscribe;
export const serverBackground = () => null;

async function load(): Promise<void> {
  const stored = thumb();
  if (!stored) {
    publish(null);
    return;
  }

  snapshot = stored;
  emit();

  try {
    const blob = await openImageStore<Blob | undefined>("readonly", (table) => table.get(KEY));
    if (blob) publish(blob);
  } catch {
    // The thumbnail is already showing, which is the whole point of keeping one.
  }
}

function publish(blob: Blob | null): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = blob ? URL.createObjectURL(blob) : null;
  snapshot = objectUrl;
  read = true;
  paint();
  emit();
}

/** Points the background layer at whatever is current. Called on every change, and on boot. */
export function paint(): void {
  const url = snapshot;
  setVars({ "--app-bg-image": url ? `url(${JSON.stringify(url)})` : null });
  setFlag("bgImage", url ? "true" : null);
}

/** The fit, dimming and blur — everything about the picture except which picture it is. */
export function applyBackgroundPrefs(prefs: BackgroundPrefs, light: boolean): void {
  setVars(backgroundVars(prefs, light));
}

async function redraw(file: File): Promise<{ full: Blob; thumb: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const draw = (limit: { width: number; height: number }, type: string, quality: number) => {
      const scale = Math.min(1, limit.width / bitmap.width, limit.height / bitmap.height);
      const canvas = Object.assign(document.createElement("canvas"), {
        width: Math.max(1, Math.round(bitmap.width * scale)),
        height: Math.max(1, Math.round(bitmap.height * scale)),
      });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser can't process images.");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return { canvas, type, quality };
    };

    const big = draw(FULL, "image/webp", 0.8);
    const full = await new Promise<Blob | null>((resolve) =>
      big.canvas.toBlob(resolve, big.type, big.quality),
    );
    if (!full) throw new Error("This browser couldn't encode that picture.");

    // The thumbnail sits in localStorage, which is a handful of megabytes for the whole app, so
    // it is small and soft on purpose — it is shown blurred under a scrim for one frame.
    const small = draw({ width: THUMB, height: THUMB }, "image/webp", 0.5);
    const encoded = small.canvas.toDataURL("image/webp", 0.5);
    const thumbUrl = encoded.startsWith("data:image/webp")
      ? encoded
      : small.canvas.toDataURL("image/jpeg", 0.5);

    return { full, thumb: thumbUrl };
  } finally {
    bitmap.close();
  }
}

export async function setBackgroundImage(file: File): Promise<void> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("That picture is too large for this browser to keep.");
  }
  if (!ACCEPT.split(",").includes(file.type)) {
    throw new Error("That has to be a PNG, JPEG, WebP or AVIF.");
  }

  const { full, thumb: small } = await redraw(file);

  try {
    await openImageStore("readwrite", (table) => table.put(full, KEY));
  } catch (cause) {
    throw new Error(
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "This browser is out of storage. Remove a picture or some playlists."
        : "Couldn't save that picture in this browser.",
    );
  }

  // Second, and allowed to fail: losing the thumbnail costs a frame of flat colour on the next
  // load, not the picture. Storing it first and failing here would have left the reverse.
  if (!writeItem(THUMB_KEY, small)) writeItem(THUMB_KEY, null);
  publish(full);
}

export function clearBackgroundImage(): void {
  writeItem(THUMB_KEY, null);
  publish(null);
  void openImageStore("readwrite", (table) => table.delete(KEY)).catch(() => {});
}

export const hasBackgroundImage = (): boolean => thumb() !== null;
