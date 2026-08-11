"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and only in production.
 *
 * **Never in development, and that is not caution — it actively breaks things.**
 * A worker that caches the shell sits in front of Next's dev server, so an edit
 * recompiles, the browser reloads, and the *previous* page comes back off disk.
 * The symptom is a change that "does not apply" until the cache is cleared by
 * hand, which is a long and unpleasant thing to debug.
 *
 * Registration is deferred to `load` so it competes with nothing on the
 * critical path: the first visit should render before it spends bandwidth
 * caching pages for a second visit that may never come.
 *
 * A failure here is silent by design. The worker is a launch-speed optimisation
 * for an app that needs the network regardless — an install that fails behind a
 * corporate proxy, or in a browser with storage disabled, costs nothing that
 * matters and should not raise anything at anyone.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    /*
     * Not registering is not the same as not being registered.
     *
     * This used to return here and consider the job done, which left a worker
     * installed by a production build on the same origin — `next start` on
     * localhost, once — running against every dev session afterwards, serving
     * `/_next/static` from a cache it never revalidates. Days of "the site is
     * broken" came out of that.
     *
     * The eviction that actually rescues a poisoned session is inline in
     * `layout.tsx`, because it has to run before any chunk the stale worker
     * would serve. This is the same intent from the component side: belt and
     * braces, and the place a reader looks first.
     */
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
