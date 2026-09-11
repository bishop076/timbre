export interface BackoffOptions {
  defaultSeconds: number;
  maxSeconds: number;
  now?: () => number;
}

export interface Backoff {
  remainingSeconds(): number;
  trip(retryAfter: string | null): number;
}

export function parseRetryAfter(value: string | null, now: number): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (!/[a-z]/i.test(trimmed)) return null;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export function isBackoffSignal(status: number, retryAfter: string | null): boolean {
  return status === 429 || (status === 503 && Boolean(retryAfter?.trim()));
}

export function createBackoff({ defaultSeconds, maxSeconds, now = Date.now }: BackoffOptions): Backoff {
  let until = 0;

  return {
    remainingSeconds() {
      const left = until - now();
      return left > 0 ? Math.ceil(left / 1000) : 0;
    },

    trip(retryAfter) {
      const at = now();
      const asked = parseRetryAfter(retryAfter, at);
      const seconds = Math.min(maxSeconds, Math.max(1, asked ?? defaultSeconds));
      until = Math.max(until, at + seconds * 1000);
      return Math.ceil((until - at) / 1000);
    },
  };
}
