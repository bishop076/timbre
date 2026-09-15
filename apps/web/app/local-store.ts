import { useSyncExternalStore } from "react";

type Area = "localStorage" | "sessionStorage";

export function readItem(key: string, area: Area = "localStorage"): string | null {
  try {
    return window[area].getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string | null, area: Area = "localStorage"): boolean {
  try {
    if (value === null) window[area].removeItem(key);
    else window[area].setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson(key: string): unknown {
  try {
    return JSON.parse(readItem(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * Answers whether the value is now in storage, for every reason it might not be.
 *
 * `JSON.stringify` throws on a cycle and on a `BigInt`, and returns `undefined` for a function
 * or an `undefined` — none of which this app means to write, but the throw was outside the one
 * `try` that guards a write. `persist()` in `playlists/store.ts` and `rememberCharts` both call
 * this bare, so an unserialisable value there would have come out of `createPlaylist` as an
 * exception rather than as the storage failure this function exists to report.
 */
export function writeJson(key: string, value: unknown): boolean {
  let text: string | null;
  try {
    text = value === null ? null : (JSON.stringify(value) ?? null);
  } catch {
    return false;
  }
  return text === null && value !== null ? false : writeItem(key, text);
}

/**
 * An id for a record this browser is about to store.
 *
 * `crypto.randomUUID` exists only in a secure context, and this app is documented as
 * self-hostable over plain http on a LAN address — where `localhost` is exempt and `192.168.x.x`
 * is not. On that origin the bare call is a `TypeError`, which took out `createPlaylist`
 * altogether and threw out of `importPlaylists` halfway through merging a file, after it had
 * already changed playlists in memory and before anything was written. `use-tab-sync.ts` has
 * always guarded its own call this way; nothing that stores a record did.
 */
export function newId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createNotifier(onStorage?: (event: StorageEvent) => void) {
  const listeners = new Set<() => void>();

  return {
    emit(): void {
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (onStorage) window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (onStorage && listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
  };
}

export function createLocalStore<T>({
  initial,
  read = () => initial,
  write,
  keys,
  onFirstRead,
}: {
  initial: T;
  read?: () => T;
  write?: (value: T) => boolean | void;
  keys?: readonly string[];
  onFirstRead?: (value: T) => void;
}) {
  let snapshot = initial;
  let loaded = false;
  const notifier = createNotifier(keys ? onStorage : undefined);

  function publish(value: T): void {
    loaded = true;
    snapshot = value;
    notifier.emit();
  }

  function onStorage(event: StorageEvent): void {
    if (!event.key || !keys?.includes(event.key)) return;
    publish(read());
  }

  return {
    subscribe: notifier.subscribe,

    getSnapshot(): T {
      if (!loaded) {
        loaded = true;
        snapshot = read();
        onFirstRead?.(snapshot);
      }
      return snapshot;
    },

    getServerSnapshot: () => initial,

    publish,

    /**
     * Publishes the value, and answers whether storage took it.
     *
     * A failed write used to be swallowed whole and the caller told nothing, which is fine for a
     * preference and is not fine for a log that grows: once `timbre:plays` is too big for what
     * is left of the quota, every later play fails the same way, and the stats simply stop
     * moving with nothing anywhere saying so. Publishing regardless is deliberate — the value is
     * live in this tab either way — but a caller that can do something about the failure now
     * has the chance to.
     */
    save(value: T): boolean {
      let stored = true;
      try {
        stored = write ? write(value) !== false : true;
      } catch {
        stored = false;
      }
      publish(value);
      return stored;
    },

    load(): void {
      if (!loaded) publish(read());
    },
  };
}

export function createJsonStore<T>(
  key: string,
  initial: T,
  parse: (stored: unknown) => T,
  { crossTab = true } = {},
) {
  return createLocalStore<T>({
    initial,
    read: () => {
      const stored = readJson(key);
      return stored === null ? initial : parse(stored);
    },
    write: (value) => writeJson(key, value),
    keys: crossTab ? [key] : undefined,
  });
}

export function useLocalStore<T>(store: ReturnType<typeof createLocalStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
