import "server-only";

/**
 * One way in to Deezer's public catalogue: no key, a timeout, Deezer's habit of answering
 * `200` with an `error` object in the body, and a failure that must not take a page down.
 *
 * Every call is cached at the fetch layer, which is what makes this safe to call several
 * times per page — Deezer's rate limit is shared across every visitor of a deployment,
 * since they all leave by one address.
 */
export async function deezer<T>(path: string, revalidateSeconds = 86_400): Promise<T | null> {
  try {
    const response = await fetch(`https://api.deezer.com${path}`, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: revalidateSeconds },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as T & { error?: unknown };
    // Deezer signals quota and validation failures inside a 200 body rather
    // than with a status code, so the happy path has to be checked explicitly.
    return body && "error" in body && body.error ? null : body;
  } catch {
    // Unreachable, slow or malformed — all the same answer. Every caller treats `null` as
    // "this section has nothing to show" and renders without it.
    return null;
  }
}
