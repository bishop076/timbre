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

/**
 * What each picture will take, named rather than refused.
 *
 * This was a blocklist of one — SVG, because it can carry script — and
 * everything else was waved through on `type.startsWith("image/")`. A list of
 * what is *allowed* is the safer shape: the failure mode of a blocklist is a
 * format nobody considered getting in, and browsers keep adding them.
 *
 * **The two differ on GIF, deliberately.** A banner is a wide still behind a
 * name, and an animation looping under someone's own profile at that size is a
 * distraction they cannot turn off. An avatar is 512px in a circle, which is
 * where an animated picture is a bit of personality rather than a nuisance.
 *
 * AVIF is gone from both. It was in the old `accept` list, but browser support
 * for *decoding* it into a canvas is not the same as support for displaying
 * it, and offering a format that fails at the redraw step is worse than not
 * offering it.
 */
const ACCEPTED: Record<ImageKind, string[]> = {
  avatar: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  banner: ["image/png", "image/jpeg", "image/webp"],
};

/** Guard before decoding — a malformed huge file should fail fast and cheap. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * The cap for a picture kept exactly as it arrived.
 *
 * An animated GIF cannot go through the canvas — see `redraw` — so it is stored
 * at its original weight, and the usual 25MB guard is far too generous for
 * something that has to be held in this browser's storage and decoded on every
 * paint of the page. Five is roomy for an avatar and small enough that a
 * screen-recording somebody dragged in fails immediately, with a reason.
 */
const MAX_ANIMATED_BYTES = 5 * 1024 * 1024;

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

/**
 * One connection, reused.
 *
 * Every call used to open its own, and none of them ever closed it: reading a
 * profile took six `indexedDB.open`s and left six live connections behind for
 * the life of the tab. Open connections are also what block a version upgrade,
 * so a future `DB_VERSION` bump would have hung against handles nothing could
 * reach to close.
 *
 * The promise is cached rather than the database, so concurrent callers share
 * one attempt; a connection closed underneath us — which the browser does when
 * it evicts storage — drops the cache so the next call reopens rather than
 * failing forever.
 */
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
 * Waits for a picture to be decoded before anything is asked to draw it.
 *
 * **This is what stops the avatar flickering on every load, and the cause is
 * worth stating exactly.** The picture arrives in two stages by design: the
 * `localStorage` thumbnail paints in the first frame, then IndexedDB answers with
 * the full-resolution copy. Those are two *different* URLs — the second a freshly
 * minted `blob:` — so swapping them is not a no-op to the browser. It drops the
 * old background, finds the new one undecoded, and paints the element's own grey
 * until the decode finishes. One frame of a grey disc where a face was, on every
 * refresh.
 *
 * Decoding first means the swap happens between two images that are both ready,
 * which is the only version of it that cannot be seen. The thumbnail stays on
 * screen for the few extra milliseconds this costs, so nothing is missing in the
 * meantime.
 *
 * Failure is ignored on purpose: an undecodable blob is no worse published than
 * withheld, and the element falls back to the monogram either way.
 */
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
async function adoptOrphans(missing: ImageKind[]): Promise<boolean> {
  let adopted = false;

  for (const kind of missing) {
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
        adopted = true;
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
      adopted = true;
    } catch {
      // Leave the old value alone rather than dropping a picture that could
      // not be converted; it will be retried on the next load.
    }
  }

  return adopted;
}

/** Reads both pictures once. Concurrent callers share the same attempt. */
function load(): Promise<void> {
  if (loading) return loading;
  if (snapshot.loaded) return Promise.resolve();

  loading = (async () => {
    try {
      /*
       * The pictures are read first, and the migration only runs if one is
       * missing.
       *
       * It used to be the other way round, which put two `getAllKeys` scans and
       * a `localStorage` sweep in front of the read on **every single load** —
       * for a browser that has nothing to migrate, which is every browser after
       * the first time. That is latency spent before the avatar can appear, and
       * the whole difficulty on this page is the avatar appearing late.
       */
      let [avatar, banner] = await Promise.all([
        run<Blob | undefined>("readonly", (store) => store.get(keyFor("avatar"))),
        run<Blob | undefined>("readonly", (store) => store.get(keyFor("banner"))),
      ]);

      const missing = (["avatar", "banner"] as const).filter((kind) =>
        kind === "avatar" ? !avatar : !banner,
      );

      if (missing.length > 0 && (await adoptOrphans(missing))) {
        [avatar, banner] = await Promise.all([
          run<Blob | undefined>("readonly", (store) => store.get(keyFor("avatar"))),
          run<Blob | undefined>("readonly", (store) => store.get(keyFor("banner"))),
        ]);
      }

      /*
       * The object URLs are created, decoded, and only then published.
       *
       * Publishing first and letting the elements decode as they paint is what
       * produced the flicker — see `decoded`. The thumbnail is still on screen
       * throughout, so this wait costs nothing visible.
       */
      const nextAvatar = avatar ? URL.createObjectURL(avatar) : null;
      const nextBanner = banner ? URL.createObjectURL(banner) : null;
      await Promise.all([decoded(nextAvatar), decoded(nextBanner)]);

      // Revoked only now that their replacements are ready to draw. A thumbnail
      // is a data URL and revoking one is a harmless no-op.
      if (snapshot.avatar) URL.revokeObjectURL(snapshot.avatar);
      if (snapshot.banner) URL.revokeObjectURL(snapshot.banner);

      snapshot = { loaded: true, avatar: nextAvatar, banner: nextBanner };

      /*
       * Backfill a thumbnail that is missing, or one from an older generation.
       *
       * Without this the small copy only ever appears for a picture chosen
       * *after* this code shipped, so everybody already using Timbre would keep
       * seeing the monogram first until they happened to re-upload — a fix that
       * requires the reader to do something is not a fix. The same argument
       * applies to a thumbnail that exists but is too small to be drawn at the
       * size it is drawn at, which is why the version is checked and not just
       * the presence — see `THUMB_VERSION`.
       *
       * Runs after the snapshot is assigned, and never awaited, so it cannot
       * delay the picture appearing. The reader sees the old thumbnail on this
       * load and the sharp one from the next.
       */
      const stale = !thumbsAreCurrent();
      for (const [kind, blob] of [
        ["avatar", avatar],
        ["banner", banner],
      ] as const) {
        if (blob && (stale || !readThumb(kind))) void writeThumb(kind, blob);
      }
    } catch {
      /*
       * Private browsing blocks IndexedDB entirely.
       *
       * The thumbnails already in the snapshot are **kept**, not discarded.
       * They came from `localStorage`, which is a different store with
       * different failure modes, and throwing them away turned a browser that
       * could still show a small copy of the picture into one that showed the
       * monogram — a downgrade caused entirely by handling the error.
       */
      snapshot = { ...snapshot, loaded: true };
    } finally {
      loading = null;
      emit();
    }
  })();

  return loading;
}

/**
 * Another tab changed a picture; re-read rather than diverging.
 *
 * IndexedDB fires no cross-document event, but every write here is accompanied
 * by its `localStorage` thumbnail — and *that* fires one. So the thumbnail is
 * both the fast copy and the notification, and the re-read below picks up the
 * full-resolution version that landed with it. Without this, changing your
 * picture in one tab left every other tab wearing the old one indefinitely.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== THUMB_KEY.avatar && event.key !== THUMB_KEY.banner) return;

  // `load()` returns early once settled, so the flag has to come down first.
  // The thumbnail itself is deliberately *not* re-read into the snapshot: the
  // reload below fetches the full-resolution picture and swaps the object URLs
  // over properly, revoking the ones it replaces.
  snapshot = { ...snapshot, loaded: false };
  void load();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/**
 * A small copy of each picture, in `localStorage`, read on the first render.
 *
 * **This is what stops the profile arriving in stages.** The pictures live in
 * IndexedDB, which cannot be read during a render — so the first paint had no
 * photograph and drew the monogram instead, replacing it a moment later. Every
 * attempt to hide that gap made things worse: hiding the avatar left a bare
 * ring, hiding the header left an empty band, and hiding the name made a
 * profile look deleted on every reload.
 *
 * The gap cannot be hidden, so it is removed. A thumbnail is a few kilobytes of
 * base64 — small enough for synchronous storage, large enough to *be* the
 * picture at the sizes it is shown. The full-resolution version replaces it
 * when IndexedDB answers, and the swap is invisible because it is the same
 * image.
 *
 * Deliberately not the whole file: an animated GIF avatar is capped at 5MB, and
 * base64 of that would exceed the entire storage quota on its own.
 */
const THUMB_KEY: Record<ImageKind, string> = {
  avatar: "timbre:thumb-avatar",
  banner: "timbre:thumb-banner",
};

/**
 * How big the synchronous copy is, per picture — **measured from where it is
 * actually drawn**, which is the part the first version got wrong.
 *
 * Both of these were 96px. That is right for the two places the avatar is small
 * (32px in the rail, 36px in the phone's corner) and badly wrong for the one
 * place it is large: the profile header draws it at 192px, which is 384 device
 * pixels on a 2× screen and 576 on a phone at 3×. A 96px source upscaled four
 * to six times is not "the right picture for an instant" — it is a visibly
 * mushy one, and since the whole point of this copy is that it is what you see
 * first, a soft first paint is the *only* thing you see.
 *
 * 384 covers a desktop header at 2× and a phone's 128px avatar at 3× exactly.
 * The banner is worse served by a single number — it spans the full width of the
 * page — so 768 is a deliberate compromise rather than a fit: enough that a
 * blurred, scrimmed backdrop reads correctly for the moment before the real one
 * lands, without putting a megabyte of base64 in a 5MB pool shared with every
 * playlist.
 *
 * A WebP at these sizes is tens of kilobytes, not hundreds — see the encoder
 * fallback in `writeThumb` for what happens on a browser that cannot make one.
 */
const THUMB_SIZE: Record<ImageKind, number> = { avatar: 384, banner: 768 };

/**
 * Which generation of thumbnail is in storage.
 *
 * Without this, raising the sizes above would only ever help somebody who
 * *changed their picture afterwards*: the backfill in `load()` writes a
 * thumbnail only when one is missing, and a 96px one is not missing. Everybody
 * already using Timbre would have kept the soft first paint for ever, which is
 * the same "a fix nobody receives is not a fix" this file argues elsewhere.
 *
 * Bumped whenever `THUMB_SIZE` or the encoding changes; the mismatch is what
 * triggers a regeneration from the full-resolution copies.
 */
const THUMB_VERSION = "2";
const THUMB_VERSION_KEY = "timbre:thumb-version";

function thumbsAreCurrent(): boolean {
  try {
    return window.localStorage.getItem(THUMB_VERSION_KEY) === THUMB_VERSION;
  } catch {
    // No storage means no thumbnails to be out of date.
    return true;
  }
}

function readThumb(kind: ImageKind): string | null {
  try {
    const raw = window.localStorage.getItem(THUMB_KEY[kind]);
    // Only ever written by `writeThumb`, but this is user-editable storage, so
    // anything that is not a data URL is discarded rather than put in `src`.
    return raw?.startsWith("data:image/") ? raw : null;
  } catch {
    return null;
  }
}

/** True once the thumbnails have been read into the snapshot. */
let thumbed = false;

function getSnapshot(): LocalImages {
  /*
   * Read once, on the first *client* snapshot — the same shape `theme-store`
   * and `playlists/store` use, and impossible on the server, which has no
   * storage. `loaded` stays false: IndexedDB has still not answered, and the
   * callers that gate on it are asking about that, not about this.
   */
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

  if (!ACCEPTED[kind].includes(file.type)) {
    /*
     * Named formats, and a different sentence for the case somebody will
     * actually hit: a GIF on the banner is a reasonable thing to try, and "not
     * an image Timbre can use" would be a confusing answer about a file the
     * avatar accepts happily.
     */
    throw new Error(
      file.type === "image/gif"
        ? "Banners have to be a still picture — try a PNG, JPEG or WebP. GIFs work on your profile picture."
        : "That has to be a PNG, JPEG or WebP.",
    );
  }

  /*
   * An animated avatar is stored exactly as it arrived.
   *
   * Everything else here goes through a canvas, and a canvas has one frame —
   * drawing a GIF to it produces a still of whichever frame happened to be
   * decoded, so "GIFs allowed" would have meant "GIFs silently flattened",
   * which is worse than refusing them. Skipping the redraw keeps the animation
   * at the cost of the resize, so the size limit does that job instead.
   *
   * The type is re-checked rather than trusted from `ACCEPTED`: only the avatar
   * reaches here with a GIF, and being explicit stops a later edit to the
   * banner's list from quietly turning this on for it too.
   */
  if (kind === "avatar" && file.type === "image/gif") {
    if (file.size > MAX_ANIMATED_BYTES) {
      throw new ImageTooLargeError(
        "That GIF is too large — animated pictures are kept at full size, so they have to be under 5MB.",
      );
    }
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width: maxWidth, height: maxHeight } = SIZES[kind];

  /*
   * The target is a **maximum**, and it never scales up.
   *
   * This used to force every picture to exactly 512×512, whatever it started as
   * — so a 200px avatar off a phone or a social-media crop was stretched to two
   * and a half times its size and then re-encoded at quality 0.82. That bakes
   * the upscale in permanently: the interpolated pixels are what get compressed,
   * so the stored picture is both larger in bytes and visibly softer than the
   * file it came from, and no amount of drawing it smaller later recovers the
   * detail. A small picture is now kept small and sharp, and the browser scales
   * it to the element like it would any other image.
   *
   * The crop is expressed as a source rectangle rather than as an oversized
   * destination, which is the same "cover" result stated directly: take the
   * largest centred region of the source that has the target's aspect ratio,
   * and write it out at up to the target size.
   */
  const cropWidth = Math.min(bitmap.width, (bitmap.height * maxWidth) / maxHeight);
  const cropHeight = Math.min(bitmap.height, (bitmap.width * maxHeight) / maxWidth);
  const shrink = Math.min(1, maxWidth / cropWidth);
  const width = Math.max(1, Math.round(cropWidth * shrink));
  const height = Math.max(1, Math.round(cropHeight * shrink));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't process images.");

    // Better resampling for the downscale, where a browser offers a choice.
    context.imageSmoothingQuality = "high";

    context.drawImage(
      bitmap,
      (bitmap.width - cropWidth) / 2,
      (bitmap.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height,
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
/**
 * Writes the small synchronous copy — see `THUMB_KEY`.
 *
 * 96px on the long edge. Big enough to be indistinguishable in the sidebar and
 * the mobile corner, and to read as the right picture in the profile header
 * for the instant before the full one lands; small enough that a WebP of it is
 * a couple of kilobytes.
 *
 * Failure is silent and costs only the optimisation: a browser that cannot
 * encode WebP, or that is out of storage, simply goes back to showing the
 * monogram first.
 */
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

    /*
     * WebP, or JPEG rather than whatever the browser felt like.
     *
     * `toDataURL` does not fail on a type it cannot encode — it silently hands
     * back a PNG. At 96px that was a rounding error; at 384 and 768 a PNG of a
     * photograph is several hundred kilobytes before base64 inflates it by a
     * third, which is a real bite out of the same 5MB pool the playlists live
     * in. The type is checked rather than assumed, exactly as `redraw` does.
     */
    let encoded = canvas.toDataURL("image/webp", 0.7);
    if (!encoded.startsWith("data:image/webp")) {
      encoded = canvas.toDataURL("image/jpeg", 0.72);
    }

    window.localStorage.setItem(THUMB_KEY[kind], encoded);
    window.localStorage.setItem(THUMB_VERSION_KEY, THUMB_VERSION);
    if (kind === "avatar") paintAvatarVariables();
  } catch {
    // Quota, an unsupported encoder, or a blob that will not decode.
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

/**
 * Keeps `<html>`'s avatar variables in step with the thumbnail.
 *
 * The boot script sets these once, before the first paint, from whatever
 * storage held at that moment — so within a session they are a **record of the
 * past**, and nothing was updating them. `Avatar` no longer reads them after
 * hydration, which is what actually fixed the removed-picture-that-would-not-go
 * bug, but leaving a stale `url(…)` of a deleted photograph on the document is
 * a loaded gun for the next thing that reads it. Cleared and rewritten with the
 * thumbnail itself, so the two cannot disagree.
 */
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

export async function setLocalImage(kind: ImageKind, file: File): Promise<void> {
  const blob = await redraw(file, kind);
  await writeThumb(kind, blob);

  try {
    await run("readwrite", (store) => store.put(blob, keyFor(kind)));
  } catch (cause) {
    /*
     * The thumbnail is rolled back with it.
     *
     * It is written first — it has to be, it is what makes the picture appear
     * instantly — so a failed save left a small copy in `localStorage` of a
     * picture that was never stored. The next load then showed that copy at
     * first paint and took it away again the moment IndexedDB answered with
     * nothing: a ghost of a picture the reader had already been told was not
     * saved.
     */
    dropThumb(kind);

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
  // Before anything else: a thumbnail left behind would be re-read on the next
  // load and the removed picture would come back for a frame.
  dropThumb(kind);

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
