const TTL_MS = 4 * 60 * 60 * 1000;

const CRAWL_BUDGET_MS = 15_000;

const RETRY_AFTER_MS = 5 * 60 * 1000;

const HYDRATION_PATTERN = /\{"hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{32})"/;

const ASSET_PATTERN = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;

const CLIENT_ID_PATTERN = /client_id[:=]"([A-Za-z0-9]{20,})"/;

export function assetScripts(html: string): string[] {
  return [...html.matchAll(ASSET_PATTERN)].map((match) => match[1]!);
}

export function hydratedClientId(html: string): string | null {
  return HYDRATION_PATTERN.exec(html)?.[1] ?? null;
}

export function clientIdFrom(javascript: string): string | null {
  return CLIENT_ID_PATTERN.exec(javascript)?.[1] ?? null;
}

interface Cached {
  id: string;
  at: number;
}

async function text(url: string, userAgent: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent },
      cache: "no-store",
      signal,
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

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

export function createClientIdResolver(userAgent: string, deadlineMs = 2500) {
  let cached: Cached | null = null;
  let inFlight: Promise<string | null> | null = null;
  let failedAt = 0;

  return async function clientId(): Promise<string | null> {
    const now = Date.now();
    if (cached && now - cached.at < TTL_MS) return cached.id;
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
