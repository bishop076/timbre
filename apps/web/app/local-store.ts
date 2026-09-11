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

export function writeJson(key: string, value: unknown): boolean {
  return writeItem(key, value === null ? null : JSON.stringify(value));
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
  write?: (value: T) => void;
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

    save(value: T): void {
      try {
        write?.(value);
      } catch {}
      publish(value);
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
