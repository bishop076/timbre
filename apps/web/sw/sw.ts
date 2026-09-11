const sw = self as unknown as ServiceWorkerGlobalScope;

const VERSION = "timbre-v3";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ["/", "/explore", "/library"];

sw.addEventListener("install", (event) => {
  void sw.skipWaiting();
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
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
  const { origin, pathname } = new URL(request.url);

  if (request.method !== "GET" || origin !== sw.location.origin) return;
  if (pathname.startsWith("/api/") || /^\/profile(\/|$)/.test(pathname)) return;
  if (pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
  else if (request.mode === "navigate") event.respondWith(networkFirst(request));
});

async function store(name: string, request: Request, response: Response): Promise<Response> {
  if (response.ok) {
    const cache = await caches.open(name);
    void cache.put(request, response.clone());
  }
  return response;
}

async function cacheFirst(request: Request): Promise<Response> {
  return (await caches.match(request)) ?? store(ASSETS, request, await fetch(request));
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    return await store(SHELL, request, await fetch(request));
  } catch {
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
