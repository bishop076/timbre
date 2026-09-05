/**
 * Timbre's service worker.
 *
 * **This is the source; the browser gets `public/sw.js`.** A service worker is a
 * plain script fetched by URL, so it cannot be TypeScript on the wire. `next.config.ts`
 * transpiles this file to `public/sw.js` every time Next starts — dev, build, or start
 * — and that output is git-ignored. Edit here; never edit the generated file. Types
 * are checked by `tsc -p sw` as part of `pnpm typecheck`.
 *
 * **What this can and cannot do, stated plainly.** Timbre plays audio it does
 * not own, out of a YouTube iframe, over the network. So there is no version of
 * this that lets you listen offline — no amount of caching changes that, and a
 * worker that implied otherwise would be lying with a loading spinner.
 *
 * What it buys is a real app launch: the shell, the fonts and the scripts come
 * off disk instead of the network, so an installed Timbre opens instantly and
 * survives a flaky connection long enough to say so.
 *
 * Three rules, one per kind of request, and the differences between them are
 * the whole design:
 *
 * - **Static build assets** — cache-first, forever. Next fingerprints every
 *   file under `/_next/static`, so a given URL's bytes never change and a
 *   revalidation request would be pure waste.
 * - **Pages** — network-first, cache as fallback. Charts and rankings move, so
 *   a stale page served in preference to a fresh one is a bug; the cached copy
 *   exists for the case where the network is not there at all.
 * - **Everything else, including `/api`** — straight to the network, never
 *   cached. These answers are already cached server-side with deliberate
 *   lifetimes, and caching them again here would put a second, invisible
 *   staleness on top of one that was reasoned about.
 *
 * One page is excluded from all of it — see `PERSONAL`.
 */

/*
 * The worker's global, typed as what it is. `lib.webworker` types `self` as a generic
 * `WorkerGlobalScope`, which has no `skipWaiting` or `clients`; the service-worker
 * scope is a subtype it cannot know this file runs in. The cast is the one place that
 * knowledge is stated, and every listener below gets its event type from it —
 * `install` is an ExtendableEvent, `fetch` a FetchEvent — with no annotations.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

/*
 * Bumped from v2. `activate` deletes every cache whose name does not start with
 * the current version, so changing this is how a deployment throws away what
 * the previous one stored — including anything a dev server on the same origin
 * was mistakenly given, and the `/profile` documents v2 kept before `PERSONAL`
 * existed.
 */
const VERSION = "timbre-v3";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

/** Pages worth having on disk before they are asked for. */
const PRECACHE = ["/", "/explore", "/library"];

/**
 * The one page whose HTML is not the same for every request.
 *
 * `/profile` is rendered from the `timbre-name` cookie, so its markup contains
 * the reader's own display name — the only personalised byte the server ever
 * emits. Storing that in a cache is wrong on two counts: it survives a rename,
 * so an offline visit would show a name that had been changed or cleared; and
 * `Cache-Control: no-store`, which Next sends on a cookie-dependent route, means
 * a cache is being asked not to keep it. Everything on this page comes out of
 * local storage anyway, so there is nothing offline to gain by keeping it.
 */
const PERSONAL = "/profile";

sw.addEventListener("install", (event) => {
  // The new worker takes over on the next load rather than waiting for every
  // tab to close — an app whose update lands "sometime later" is one that gets
  // bug reports about behaviour that was fixed a week ago.
  void sw.skipWaiting();
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // `reload` so an install never re-caches a stale copy the HTTP cache is
      // still holding. Individually, because one 404 must not fail the install.
      Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })))),
    ),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET is cacheable, and only this origin is ours to cache. Artwork and
  // audio come from other people's CDNs with their own rules.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === PERSONAL || url.pathname.startsWith(`${PERSONAL}/`)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS);
    void cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL);
      void cache.put(request, response.clone());
    }
    return response;
  } catch {
    /*
     * Offline. The cached copy of this page, or the home page, or an honest
     * sentence — in that order.
     *
     * The last fallback is deliberately not a styled offline page: reaching it
     * means the shell itself is not cached, so any page served here would be
     * unstyled anyway. Better a clear sentence than a broken layout.
     */
    const cached = (await caches.match(request)) ?? (await caches.match("/"));
    if (cached) return cached;

    return new Response(
      "<!doctype html><meta charset=utf-8><title>Timbre is offline</title>" +
        "<body style=\"font:16px system-ui;padding:2rem;background:#0f0f14;color:#fff\">" +
        "<h1>No connection</h1><p>Timbre plays music from other services, so it needs the network. " +
        "Your playlists are safe — they live in this browser.</p>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
