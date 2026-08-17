/**
 * The skeleton the browser-stored stores here all repeat: one lazy read of `localStorage`, a
 * set of listeners, and a `storage` handler so tabs agree. Hand-written copies of it drifted,
 * and the lazy read's stability contract is the part that breaks quietly.
 */

import { useSyncExternalStore } from "react";

/** Listeners, the notify, and a `storage` listener attached only while something subscribes. */
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
        // Last unsubscribe only: the one handler serves every listener.
        if (onStorage && listeners.size === 0) {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
  };
}

export interface LocalStoreOptions<T> {
  /** Reads and validates storage. Owns its own try/catch: what a blocked or corrupt read
   * should fall back to differs per store. */
  read: () => T;
  /** The pre-read value and the server snapshot. Must be referentially stable. */
  initial: T;
  /** Persists a value, for `save`. Storage failures are caught there. Omit it when the
   * caller writes storage itself and publishes the result. */
  write?: (value: T) => void;
  /** Storage keys worth following across tabs. Omitted means no `storage` listener at all. */
  keys?: readonly string[];
  /** Side effects that have to land on the first read, before the next paint. */
  onFirstRead?: (value: T) => void;
}

export interface LocalStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Publishes a value without touching storage — for a caller that has already written, or
   * that is reporting a write which failed. */
  publish: (value: T) => void;
  /** Persists, then publishes either way. */
  save: (value: T) => void;
  /** Forces the first read from an effect, notifying — which `getSnapshot` cannot do. */
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

  /** Another tab wrote one of our keys; follow it rather than diverging. */
  function onStorage(event: StorageEvent): void {
    if (!event.key || !keys?.includes(event.key)) return;
    publish(read());
  }

  return {
    subscribe: notifier.subscribe,

    getSnapshot() {
      /* Read here rather than from an effect: the read is synchronous, but from `useEffect`
       * it lands after the first paint. It happens once and every later call returns the
       * identical object, which is `useSyncExternalStore`'s stability contract. No notify —
       * telling React while it asks for a snapshot is a render-phase side effect. */
      if (!loaded) {
        loaded = true;
        snapshot = read();
        onFirstRead?.(snapshot);
      }
      return snapshot;
    },

    /** The server has no `localStorage`, and the pre-paint replay depends on it rendering
     * this one stable value. */
    getServerSnapshot: () => initial,

    publish,

    save(value) {
      try {
        write?.(value);
      } catch {
        // Quota, or storage blocked. Not being able to remember a change is no reason to
        // refuse it — it still applies for this session.
      }
      publish(value);
    },

    load() {
      if (loaded) return;
      publish(read());
    },
  };
}

/** Subscribes a component to a store. */
export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
