"use client";

/**
 * The one IndexedDB store every picture in this app lives in — the profile avatar and banner
 * under their own names, a playlist cover under `playlist:<id>`.
 *
 * Lifted out of `local-images.ts` so `playlists/playlist-image.ts` can use the same database
 * without opening a second connection to it. Two `indexedDB.open("timbre", 1)` calls would be
 * two connections to the same database, and the `onclose` bookkeeping below assumes it is the
 * only one holding it.
 */

const STORE = "images";

let connection: Promise<IDBDatabase> | null = null;

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

export async function openImageStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
