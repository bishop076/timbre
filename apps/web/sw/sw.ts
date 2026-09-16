/**
 * Timbre's service worker.
 *
 * next.config.ts transpiles this file to `public/sw.js` at build time, and app/service-worker.tsx
 * registers it — in production only — as `/sw.js?v=<version>-<commit>`.
 *
 * What it is for: making a second visit fast and an offline one honest. It is not a cache of the
 * music (Timbre hosts none) and it is deliberately not a cache of the API.
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * Which build this worker belongs to, read off its own script URL.
 *
 * A browser decides a worker has changed by comparing the *bytes* it fetches, and these bytes
 * only change when this file does. So before the `?v=` parameter existed, a deploy that did not
 * touch the worker produced no update at all: `activate` — the only place old caches are dropped
 * — never ran again, and the caches below outlived every release that made them. Putting the
 * version in the URL makes registration itself the update trigger; see service-worker.tsx.
 *
 * The fallback covers a worker registered before that parameter existed.
 */
const BUILD = new URL(sw.location.href).searchParams.get("v") ?? "unversioned";

/**
 * Documents. Versioned, because a build's HTML names that build's fingerprinted assets.
 *
 * Capped, because the key of an entry here is the whole URL: every search, every album and every
 * artist page a reader opens is its own copy of a document that inlines its own data. Fifty is
 * roughly "what I was doing recently", which is all this is for.
 */
const SHELL = `timbre-shell-${BUILD}`;
const SHELL_LIMIT = 50;

/**
 * Fingerprinted assets, deliberately *not* versioned: every key under `/_next/static/` carries a
 * content hash, so an entry is either correct forever or never asked for again. Versioning this
 * would re-download the unchanged half of the bundle on every deploy; not versioning it would
 * grow without bound, which is what `trim` is for.
 */
const ASSETS = "timbre-assets";
const ASSET_LIMIT = 300;

/** Every cache this file has ever named, so `activate` can recognise its own litter. */
const OURS = /^timbre-/;

const PRECACHE = ["/", "/explore", "/library"];

sw.addEventListener("install", (event) => {
  void sw.skipWaiting();
  event.waitUntil(
    Promise.allSettled(
      PRECACHE.map(async (url) => {
        const request = new Request(url, { cache: "reload" });
        await keep(SHELL, request, await fetch(request));
      }),
    ),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const stale = names.filter((name) => OURS.test(name) && name !== SHELL && name !== ASSETS);

      await Promise.all(stale.map((name) => caches.delete(name)));
      await trim(ASSETS, ASSET_LIMIT);
      await sw.clients.claim();

      // Only when this replaced something. A first install has nothing to announce.
      if (stale.length > 0) await announce();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== sw.location.origin) return;

  // The API, never. Every data path in the app is `/api/*` — the fetches in home-view.tsx,
  // player-context.tsx, taste-store.ts and the rest — and those routes already cache upstream
  // answers, with the freshness rules for a provider blip living there. A copy here would be a
  // second layer this app cannot invalidate: it is exactly how an outage gets stored as if it
  // were an answer and then served long after the outage is over.
  if (url.pathname.startsWith("/api/")) return;

  // Account pages. /profile is `private, no-store` in next.config.ts, and /spotify carries
  // tokens in its query and fragment; neither belongs in a cache on disk.
  if (/^\/(profile|spotify)(\/|$)/.test(url.pathname)) return;

  // The router's own payloads. They are keyed by a query string that moves with router state, so
  // caching them would fill the shell cache with entries nothing ever reads back — and a stale
  // one is a page rendered from a build that is no longer deployed.
  if (url.searchParams.has("_rsc") || request.headers.has("RSC")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event));
    return;
  }

  // Everything else — the icons, the manifest, `/_next/image` — is left to the browser's own
  // HTTP cache, which already has the right rules for it from next.config.ts.
  //
  // Navigation preload would shave this worker's start-up off the line below and is the usual
  // companion to network-first. It is absent on purpose: it fires for *every* navigation,
  // including the /profile and /spotify ones skipped above, and a preload nobody calls
  // `respondWith` with is thrown away and requested again — a second hit on the two routes least
  // able to afford one.
  if (request.mode === "navigate") event.respondWith(networkFirst(event));
});

/**
 * Documents: network first, always. The failure this avoids is the one every service worker is
 * infamous for — a cached HTML shell served to a returning visitor forever, so a deploy reaches
 * nobody. The cached copy here is only ever a fallback for a browser with no network.
 */
async function networkFirst(event: FetchEvent): Promise<Response> {
  const { request } = event;
  try {
    const response = await fetch(request);
    // Written in the background on purpose. Awaiting the write would hold the document back until
    // its whole body had been read into the cache, which for a streamed RSC response means giving
    // up streaming — a slower first paint, paid on every navigation, to save a copy nobody reads
    // unless the network is gone.
    event.waitUntil(keep(SHELL, request, response.clone()));
    return response;
  } catch {
    // The page they asked for, or an honest page saying why it is not here. Deliberately *not*
    // the cached "/": that HTML hydrates as the home route, so substituting it for /album/123
    // shows someone the home page under an album's URL and calls it a success.
    return (await caches.match(request)) ?? offline();
  }
}

/** Fingerprinted assets: the cache is authoritative, because the URL names the bytes. */
async function cacheFirst(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  event.waitUntil(keep(ASSETS, request, response.clone()));
  return response;
}

async function keep(name: string, request: Request, response: Response): Promise<void> {
  // `redirected` is the one that bites: handing a redirected response back for a navigation is a
  // TypeError in the browser ("a redirected response was used for a request whose redirect mode
  // is not follow"), and a cached one fails that way later, offline, where it cannot be
  // diagnosed. An opaqueredirect — what `fetch` returns for a navigation that redirects — is
  // not `ok`, so it is passed straight through to the browser to follow instead.
  if (!response.ok || response.redirected) return;

  // And the answer the server already gave to "may this be kept", rather than a guess at which
  // routes would give it. The skip list in `fetch` is that guess, written when /profile was the
  // only `no-store` document, and the app has outgrown it: /playlist/[id] is a dynamic route,
  // so Next answers it `private, no-cache, no-store, max-age=0, must-revalidate` — and every
  // playlist page a reader opened was written to disk here regardless, where it outlives the
  // tab and the "no-store" that was supposed to mean it never touched one. A list of paths
  // cannot keep up with a header; the header can.
  if ((response.headers.get("cache-control") ?? "").toLowerCase().includes("no-store")) return;

  const cache = await caches.open(name);
  await cache.put(request, response);
  if (name === ASSETS) await trim(ASSETS, ASSET_LIMIT);
  else await trim(name, SHELL_LIMIT, PRECACHE);
}

/**
 * `keys()` is insertion-ordered, so the front of the list is what was added longest ago — which,
 * for content-hashed URLs, is what most likely belongs to a build nobody is running.
 *
 * `protect` is the three routes installed with the worker: they are the ones worth having offline
 * whatever else a reader has been doing since. It is matched against the *whole* URL and not just
 * the path, because an entry's key here is the whole URL: `/?from=somewhere` is its own copy of
 * the home page, and while "is the pathname `/`?" was the question, every one of those copies was
 * protected. Fifty navigations carrying any query at all and the cap stopped being a cap — the
 * filter left nothing to delete and `trim` deleted nothing, quietly, on every write after that.
 */
async function trim(name: string, limit: number, protect: readonly string[] = []): Promise<void> {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  const excess = keys.length - limit;
  if (excess <= 0) return;

  const installed = (key: Request) => {
    const url = new URL(key.url);
    return url.search === "" && protect.includes(url.pathname);
  };

  const victims = keys.filter((key) => !installed(key)).slice(0, excess);
  await Promise.all(victims.map((key) => cache.delete(key)));
}

/**
 * Tell the open pages a new build took over. They are already running that build's HTML — the
 * only way this worker's URL reached the browser is a document from the same deploy — so this is
 * a line for the log panel, not a "reload now" nag at someone who already reloaded.
 */
async function announce(): Promise<void> {
  const windows = await sw.clients.matchAll({ type: "window" });
  for (const client of windows) client.postMessage({ type: "timbre:sw-updated", build: BUILD });
}

// The violet from layout.tsx and the dark surface from globals.css. The page below is served by a
// worker and can read neither, so both are copied here and have to be changed here too.
const ACCENT = "#5b3fd6";
const SURFACE = "#0b0814";

/**
 * What a reader gets for a page that is neither cached nor reachable. Being specific is the whole
 * point: "you are offline" in front of a music app invites "so play the downloaded ones", and
 * there are none — there is no download anywhere in this app, by design.
 */
function offline(): Response {
  const body = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${ACCENT}">
<title>Offline — Timbre</title>
<style>
  :root { color-scheme: dark light; --line: #2a2731;
          --fg: #f4f2f8; --dim: #a09bb0; --bg: ${SURFACE} }
  @media (prefers-color-scheme: light) {
    :root { --fg: #14121a; --dim: #5d5870; --bg: #ffffff; --line: #e6e2ee }
  }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
         background: var(--bg); color: var(--fg);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif }
  main { max-width: 34rem }
  h1 { font-size: 1.6rem; margin: 0 0 0.75rem }
  p { color: var(--dim); margin: 0 0 1rem }
  dl { border-top: 1px solid var(--line); margin: 0 0 1.5rem; padding-top: 1rem }
  dt { font-weight: 600 }
  dd { color: var(--dim); margin: 0.15rem 0 1rem }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 999px; padding: 0.6rem 1.4rem;
           background: ${ACCENT}; color: #fff; cursor: pointer }
</style>
<main>
  <h1>No connection</h1>
  <p>Timbre does not host any music. Every track plays from YouTube Music, SoundCloud, Spotify,
     Deezer or Apple Music, so searching and playing both need the network.</p>
  <dl>
    <dt>Still yours</dt>
    <dd>Playlists, likes and listening history live in this browser, not on a server. Nothing here
        is lost, and nothing was uploaded.</dd>
    <dt>Back when the network is</dt>
    <dd>Search, charts, artwork, lyrics and playback. All of it comes from somebody else's
        servers.</dd>
  </dl>
  <p>Pages you have already opened will open again offline. This one has not been.</p>
  <button type="button" id="retry">Try again</button>
</main>
<script>
  document.getElementById("retry").addEventListener("click", function () { location.reload() });
  addEventListener("online", function () { location.reload() });
</script>`;

  return new Response(body, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Without this a browser is entitled to keep the 503 for the navigation it was asked for
      // and hand it back once the network is fine again.
      "cache-control": "no-store",
    },
  });
}
