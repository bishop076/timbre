"use client";

import { useEffect } from "react";

/** Registers the service worker, and only in production — a worker caching the shell sits
 * in front of Next's dev server, so an edit recompiles, the browser reloads, and the
 * *previous* page comes back off disk. Deferred to `load`, and failure is silent. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Not registering is not the same as not being registered: returning early here left a
    // worker installed once by `next start` on localhost serving `/_next/static` from a
    // cache it never revalidates, against every dev session afterwards. The eviction that
    // rescues a poisoned session is inline in `layout.tsx`, because it has to run before
    // any chunk the stale worker serves.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((one) => one.unregister())))
        .catch(() => {
          // Nothing registered, or storage is unavailable. Either is fine.
        });
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Storage disabled, an unsupported context, or a proxy in the way.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
