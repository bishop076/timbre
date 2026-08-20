/**
 * SoundCloud's guest `client_id`, taken the way every tool in this space takes it: from the
 * JavaScript soundcloud.com serves to anyone who visits.
 *
 * **This is the technique `docs/BLOCKED.md` declined to ship, and it stays declined by
 * default.** Nothing here runs unless an operator sets `SOUNDCLOUD_DIRECT_API`, which is off
 * in the hosted build and off for anyone who clones this. The bargain is the one
 * `.env.example` already describes for `SOUNDCLOUD_API_BASE`: turning it on moves the
 * technique, the IP and the terms exposure to whoever turned it on. The difference is only
 * that this needs no second service, which is what makes it usable on a free serverless host.
 *
 * Measured 2026-08-20: the homepage takes ~1.9s and the asset bundle holding the id another
 * ~3.2s, so a cold resolve costs about **five seconds**. That is why callers get a deadline
 * rather than a promise — see `createClientIdResolver`.
 */

/** How long a resolved id is trusted. Matches soundcloak's own default. */
const TTL_MS = 4 * 60 * 60 * 1000;

/**
 * The budget for a whole crawl — the homepage plus however many bundles it takes — shared
 * by every request in it rather than applied per request, so nine slow bundles cannot add
 * up past it.
 *
 * **`fetch` has no timeout of its own, and a crawl that never settles is never retried.**
 * `inFlight` below is cleared when the promise finishes, so a single hung socket left the
 * resolver dead for the life of the instance: every later search joined the same pending
 * promise, waited out the deadline and abstained, for ever. Measured — three calls against
 * a host that accepts the connection and then says nothing made exactly one request and
 * never made another.
 */
const CRAWL_BUDGET_MS = 15_000;

/**
 * How long a failed resolve is remembered before another is attempted.
 *
 * Without it the next search retries immediately, and a crawl is up to ten requests to
 * soundcloud.com. The likeliest failure here is precisely the one that must not be retried
 * in a loop — a datacentre IP being refused, which is the normal answer for a free
 * serverless host — so an instance that could not resolve would ask the host that already
 * said no once per search for as long as it ran.
 */
const RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * The id as the page itself hydrates with it.
 *
 * It is not stored under a key called `client_id` at all — it is the `id` of an `apiClient`
 * hydratable, which is why searching the homepage for the obvious name finds nothing and
 * makes the bundles look necessary. soundcloak reads this same shape, and cobalt reads the
 * bundles as its *fallback*, not its first choice.
 *
 * Measured 2026-08-20: present on the live homepage, byte-identical to the id in the last
 * bundle, and accepted by api-v2 with full `MONETIZE` entitlement on a track the bundle id
 * also returned in full. One request instead of two, and ~1.4s instead of ~5s — which is
 * inside the resolver's deadline, so a cold instance now *includes* SoundCloud in its first
 * search instead of abstaining from it.
 */
const HYDRATION_PATTERN = /\{"hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{32})"/;

/** Their asset bundles, in document order. */
const ASSET_PATTERN = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;

/** `client_id:"…"` as it appears minified. Long enough not to match a stray key. */
const CLIENT_ID_PATTERN = /client_id[:=]"([A-Za-z0-9]{20,})"/;

/** Every asset script the homepage loads, in the order it loads them. */
export function assetScripts(html: string): string[] {
  return [...html.matchAll(ASSET_PATTERN)].map((match) => match[1]!);
}

/** The `client_id` the homepage hydrates with, if it is there. */
export function hydratedClientId(html: string): string | null {
  return HYDRATION_PATTERN.exec(html)?.[1] ?? null;
}

/** The `client_id` a bundle carries, if it carries one. */
export function clientIdFrom(javascript: string): string | null {
  return CLIENT_ID_PATTERN.exec(javascript)?.[1] ?? null;
}

interface Cached {
  id: string;
  at: number;
}

/** One request against the shared crawl budget. Refusals and timeouts are both "no text". */
async function text(url: string, userAgent: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent },
      cache: "no-store",
      signal,
    });
    return response.ok ? await response.text() : null;
  } catch {
    // Out of budget, or the host is unreachable. Neither is worth distinguishing: once the
    // signal has fired every remaining bundle returns here at once and the walk ends.
    return null;
  }
}

/**
 * The homepage first, and usually only the homepage — see `HYDRATION_PATTERN`.
 *
 * The bundle walk stays as the fallback because the hydration blob is undocumented and can
 * move; it goes **last first**, since measured the id lives in the final bundle, so it costs
 * one extra request rather than nine. Always settles — see `CRAWL_BUDGET_MS`.
 */
async function fetchClientId(userAgent: string): Promise<string | null> {
  const signal = AbortSignal.timeout(CRAWL_BUDGET_MS);

  const home = await text("https://soundcloud.com", userAgent, signal);
  if (!home) return null;

  const hydrated = hydratedClientId(home);
  if (hydrated) return hydrated;

  for (const src of assetScripts(home).reverse()) {
    const found = clientIdFrom((await text(src, userAgent, signal)) ?? "");
    if (found) return found;
  }
  return null;
}

/**
 * A resolver that answers within `deadlineMs` or not at all.
 *
 * **Abstaining beats blocking.** A cold resolve is five seconds, and search fans out to every
 * source at once, so waiting for it would make the *first* search of every cold instance five
 * seconds long for everybody. Instead the first caller starts the fetch, gives up waiting,
 * and SoundCloud sits that round out; the fetch finishes into the cache and the next search
 * has it. One search misses one source. Nobody waits.
 *
 * Single-flight, because a burst of searches on a cold instance would otherwise each start
 * their own crawl of soundcloud.com.
 */
export function createClientIdResolver(userAgent: string, deadlineMs = 2500) {
  let cached: Cached | null = null;
  let inFlight: Promise<string | null> | null = null;
  /** When the last crawl came back empty, for the back-off. Zero means none has. */
  let failedAt = 0;

  return async function clientId(): Promise<string | null> {
    const now = Date.now();
    if (cached && now - cached.at < TTL_MS) return cached.id;
    // Backing off, and nothing already running to join: abstain without asking again.
    if (!inFlight && failedAt !== 0 && now - failedAt < RETRY_AFTER_MS) return null;

    inFlight ??= fetchClientId(userAgent)
      .then((id) => {
        if (id) {
          cached = { id, at: Date.now() };
          failedAt = 0;
        } else {
          failedAt = Date.now();
        }
        return id;
      })
      .catch(() => {
        failedAt = Date.now();
        return null;
      })
      .finally(() => {
        inFlight = null;
      });

    // The timer is cleared on the way out. `Promise.race` abandons the loser rather than
    // cancelling it, so a search that gave up waiting used to leave a live timer behind for
    // the deadline's length — one per search on a cold instance, and enough to keep a
    // scale-to-zero container awake after it had already answered.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    });

    try {
      return await Promise.race([inFlight, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}
