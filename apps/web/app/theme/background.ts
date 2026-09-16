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

import { isReplayableImage } from "../customise/replay.ts";
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

/**
 * The stored thumbnail, but only if it is a value the pre-paint script would also have replayed.
 *
 * This used to be `raw?.startsWith("data:image/")`, a check on the first eleven characters of a
 * string whose last characters are the dangerous ones, with no cap on its length — and the value
 * goes straight into `paint()`, which splices it into `--app-bg-image` as `url(...)`. The boot
 * script in layout.tsx reads the *same key* and has always required base64 of a raster type under
 * 700,000 characters, so the hydrated path was accepting values the pre-paint path refused: the
 * exact divergence that makes a hardened boot script stop being worth anything. `local-images.ts`
 * was moved onto the shared rule for the profile pictures; this is the last key still on the
 * prefix check.
 *
 * Nothing the reader can choose is lost by this. `setBackgroundImage` is the only writer, and it
 * stores `canvas.toDataURL("image/webp"|"image/jpeg", 0.5)` of a canvas capped at 512x512 — always
 * base64, always one of the accepted types. Measured in Chrome, the largest that encoder will
 * produce at that size is 539,787 characters, for 512x512 of pure random RGBA noise; a photograph
 * is opaque and comes in under 200,000.
 */
function thumb(): string | null {
  const raw = readItem(THUMB_KEY);
  return isReplayableImage(raw) ? raw : null;
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

/**
 * Points the background layer at whatever is current. Called on every change, and on boot.
 *
 * `getBackground()`, not the bare `snapshot`. On boot this runs from `theme-store.apply()`,
 * which is the first thing that happens after hydration — and at that moment nothing has read
 * storage yet, so `snapshot` is still null. Painting null does not mean "leave it alone": it
 * removes --app-bg-image and the data-bg-image flag that the pre-paint script in layout.tsx had
 * already put on <html>. The reader's picture was therefore drawn before the first frame and
 * wiped a few milliseconds later, on every single load, and only came back if you happened to
 * open Appearance — the one place that calls `getBackground()`. Reading through the getter
 * seeds the snapshot from the stored thumbnail first and starts the full picture loading, so
 * the boot paint is the same picture the boot script drew.
 */
export function paint(): void {
  const url = getBackground();
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
