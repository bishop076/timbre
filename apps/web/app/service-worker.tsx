"use client";

import { useEffect } from "react";

import { log } from "./logs.ts";

/**
 * The worker's file name never changes, and its bytes only change when sw/sw.ts does — so
 * registering a bare "/sw.js" made a deploy invisible to the browser: nothing to compare, no
 * update, and `activate` (where sw.ts drops the caches of the build before it) never ran again.
 * The version in the query is what makes the registration itself change. `env` in next.config.ts
 * inlines both of these at build time; the worker reads the same string back off its own URL.
 */
const VERSION = process.env.NEXT_PUBLIC_TIMBRE_VERSION ?? "0.0.0";
const COMMIT = process.env.NEXT_PUBLIC_TIMBRE_COMMIT;
const BUILD = COMMIT ? `${VERSION}-${COMMIT}` : VERSION;
const SCRIPT = `/sw.js?v=${encodeURIComponent(BUILD)}`;

function isUpdate(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as { type?: unknown }).type === "timbre:sw-updated";
}

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((one) => one.unregister())))
        .catch(() => {});
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (!isUpdate(event.data)) return;
      // Profile → ⚙ → Logs, and nothing is asked of the reader. This page is already the new
      // build — the only way the worker's new URL reached the browser is a document from the same
      // deploy — so the news is that the offline copy now matches, not that a reload is due.
      log("info", `Offline cache updated to v${BUILD}.`);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);

    const register = () => void navigator.serviceWorker.register(SCRIPT).catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
