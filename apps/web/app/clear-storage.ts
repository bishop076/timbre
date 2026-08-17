"use client";

// Erasing what this browser holds. Timbre has no server, so what is here is the whole of
// someone's data, spread over five stores — and nothing else empties any of them.

/** A prefix sweep, not a list of the seventeen fixed keys: two families are unbounded and
 * never pruned — `timbre:chart:<genreId>` per genre ever viewed, and the legacy
 * `timbre:profile:<kind>:<userId>` — so a list would leave them behind. */
const KEY_PREFIX = "timbre:";

/** The service worker names its caches `timbre-v3-*`. */
const CACHE_PREFIX = "timbre-";

/** Written by `profile/local-profile.ts`, so the server can render the display name. */
const NAME_COOKIE = "timbre-name";

const DB_NAME = "timbre";
const DB_VERSION = 1;
const DB_STORE = "images";

function sweep(store: Storage): void {
  for (const key of Object.keys(store)) {
    if (key.startsWith(KEY_PREFIX)) store.removeItem(key);
  }
}

/** Empties the picture store — the avatar, the banner, and any orphan a regenerated
 * profile id left behind.
 *
 * Deliberately not `deleteDatabase`: `profile/local-images.ts` caches an open connection,
 * and an open connection blocks a version change, so the delete request fires `blocked`
 * and never settles. A `readwrite` transaction runs alongside that connection. */
function clearImages(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      const db = request.result;

      // A missing store would make `transaction` throw inside this handler, where nothing
      // settles the promise and the reload below never happens.
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.close();
        resolve();
        return;
      }

      const transaction = db.transaction(DB_STORE, "readwrite");
      // `oncomplete`, not the clear request's `onsuccess`: that fires before the
      // transaction commits, and the reload would outrun the write.
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
      transaction.objectStore(DB_STORE).clear();
    };
  });
}

/** Drops the offline copy of the app. Ours by prefix; another origin's caches are not
 * visible here, but a dev server on this one shares the namespace. */
async function clearCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
  );
}

/**
 * Erases every trace of Timbre from this browser, then reloads. Irreversible: there is no
 * account and no server, so nothing here has a copy anywhere else.
 *
 * Each step is isolated — private browsing blocks IndexedDB, and one refusal must not
 * abandon the four that would have worked.
 */
export async function clearEverything(): Promise<void> {
  try {
    sweep(window.localStorage);
  } catch {
    // Storage blocked, which means nothing was written to it either.
  }

  try {
    sweep(window.sessionStorage);
  } catch {
    // As above.
  }

  try {
    // The cookie's prefix is `timbre-`, not `timbre:`, so the sweep above misses it. Expired
    // rather than removed, and with the path it was set on, or the browser keeps it.
    document.cookie = `${NAME_COOKIE}=;path=/;max-age=0;SameSite=Lax`;
  } catch {
    // Cookies disabled; there was nothing to expire.
  }

  try {
    await clearImages();
  } catch {
    // Private browsing blocks IndexedDB outright.
  }

  try {
    await clearCaches();
  } catch {
    // No Cache Storage, or a name that went away mid-sweep.
  }

  // Storage is not the DOM. `<html>` carries the avatar, monogram, name, counts and wash
  // that layout.tsx's boot script stamps before paint, so without this the deleted
  // photograph stays on screen. Everything above is awaited, or the reload races it.
  location.reload();
}
