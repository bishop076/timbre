import "server-only";

export async function deezer<T>(path: string, revalidateSeconds = 86_400): Promise<T | null> {
  try {
    const response = await fetch(`https://api.deezer.com${path}`, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: revalidateSeconds },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as T & { error?: unknown };
    return body && "error" in body && body.error ? null : body;
  } catch {
    return null;
  }
}
