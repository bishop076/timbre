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

/** Their asset bundles, in document order. */
const ASSET_PATTERN = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;

/** `client_id:"…"` as it appears minified. Long enough not to match a stray key. */
const CLIENT_ID_PATTERN = /client_id[:=]"([A-Za-z0-9]{20,})"/;

/** Every asset script the homepage loads, in the order it loads them. */
export function assetScripts(html: string): string[] {
  return [...html.matchAll(ASSET_PATTERN)].map((match) => match[1]!);
}

/** The `client_id` a bundle carries, if it carries one. */
export function clientIdFrom(javascript: string): string | null {
  return CLIENT_ID_PATTERN.exec(javascript)?.[1] ?? null;
}

interface Cached {
  id: string;
  at: number;
}

async function text(url: string, userAgent: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "user-agent": userAgent }, cache: "no-store" });
  return response.ok ? await response.text() : null;
}

/**
 * Walks the homepage's bundles **last first**: measured, the id lives in the final one, so
 * this finds it in a single extra request rather than nine.
 */
async function fetchClientId(userAgent: string): Promise<string | null> {
  const home = await text("https://soundcloud.com", userAgent);
  if (!home) return null;

  for (const src of assetScripts(home).reverse()) {
    const found = clientIdFrom((await text(src, userAgent)) ?? "");
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

  return async function clientId(): Promise<string | null> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.id;

    inFlight ??= fetchClientId(userAgent)
      .then((id) => {
        if (id) cached = { id, at: Date.now() };
        return id;
      })
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });

    const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs));
    return await Promise.race([inFlight, deadline]);
  };
}
