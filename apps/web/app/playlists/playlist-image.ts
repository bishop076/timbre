"use client";

import { useEffect, useSyncExternalStore } from "react";

import { createNotifier } from "../local-store.ts";
import { log } from "../logs.ts";
import { openImageStore } from "../profile/image-store.ts";

/**
 * A picture the listener chose for one playlist.
 *
 * Kept beside the profile pictures, in the same IndexedDB store, under `playlist:<id>` — not in
 * `localStorage` with the playlists themselves. A cover is a few hundred kilobytes encoded, and
 * `timbre:playlists` already carries every song of every list in the same 5MB budget; one picture
 * would have been enough to start failing saves of the lists. There is deliberately no thumbnail
 * cached in `localStorage` the way `local-images.ts` keeps one: nothing here is painted before
 * hydration, so the blob arriving a frame late costs nothing.
 */

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const key = (id: string) => `playlist:${id}`;

/** Playlist id → object URL. Absent means "no picture", which is not the same as "not loaded". */
type Covers = Record<string, string>;

const NONE: Covers = {};

let snapshot: Covers = NONE;
let loaded = false;
let loading: Promise<void> | null = null;
const { emit, subscribe } = createNotifier();

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return openImageStore(mode, work);
}

function load(): Promise<void> {
  if (loading) return loading;
  if (loaded) return Promise.resolve();

  loading = (async () => {
    try {
      const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
      const mine = keys.filter(
        (name): name is string => typeof name === "string" && name.startsWith("playlist:"),
      );
      const blobs = await Promise.all(
        mine.map((name) => run<Blob | undefined>("readonly", (store) => store.get(name))),
      );

      const next: Covers = {};
      mine.forEach((name, index) => {
        const blob = blobs[index];
        if (blob) next[name.slice("playlist:".length)] = URL.createObjectURL(blob);
      });

      for (const url of Object.values(snapshot)) URL.revokeObjectURL(url);
      snapshot = next;
    } catch {
      // No pictures rather than no playlists: a browser with IndexedDB turned off still gets a
      // library, it just never shows a cover anybody uploaded.
    } finally {
      loaded = true;
      loading = null;
      emit();
    }
  })();

  return loading;
}

function getSnapshot(): Covers {
  return snapshot;
}

/** Every uploaded playlist cover, by playlist id. */
export function usePlaylistImages(): Covers {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => NONE);

  useEffect(() => {
    void load();
  }, []);

  return current;
}

function publish(id: string, blob?: Blob): void {
  const previous = snapshot[id];
  if (previous) URL.revokeObjectURL(previous);

  const next = { ...snapshot };
  if (blob) next[id] = URL.createObjectURL(blob);
  else delete next[id];

  snapshot = next;
  emit();
}

export async function setPlaylistImage(id: string, file: File): Promise<void> {
  const { redraw } = await import("../profile/image-resize");
  const blob = await redraw(file, "playlist");

  try {
    await run("readwrite", (store) => store.put(blob, key(id)));
  } catch (cause) {
    log("warn", `Playlist cover: ${describe(cause)}`);
    throw new Error(
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "This browser is out of storage. Remove a picture or some playlists."
        : "Couldn't save that picture in this browser.",
    );
  }

  publish(id, blob);
}

export function clearPlaylistImage(id: string): void {
  publish(id);
  void run("readwrite", (store) => store.delete(key(id))).catch(() => {});
}

/** Deleting a list should not leave its picture behind taking up room for ever. */
export function forgetPlaylistImage(id: string): void {
  clearPlaylistImage(id);
}
