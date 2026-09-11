import { useSyncExternalStore } from "react";

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
        if (onStorage && listeners.size === 0) {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
  };
}

export interface LocalStoreOptions<T> {
  read: () => T;
  initial: T;
  write?: (value: T) => void;
  keys?: readonly string[];
  onFirstRead?: (value: T) => void;
}

export interface LocalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  publish: (value: T) => void;
  save: (value: T) => void;
  load: () => void;
}

export function createLocalStore<T>({
  read,
  initial,
  write,
  keys,
  onFirstRead,
}: LocalStoreOptions<T>): LocalStore<T> {
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

    getSnapshot() {
      if (!loaded) {
        loaded = true;
        snapshot = read();
        onFirstRead?.(snapshot);
      }
      return snapshot;
    },

    getServerSnapshot: () => initial,

    publish,

    save(value) {
      try {
        write?.(value);
      } catch {
      }
      publish(value);
    },

    load() {
      if (loaded) return;
      publish(read());
    },
  };
}

export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
