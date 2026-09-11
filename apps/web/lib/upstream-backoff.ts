interface BackoffOptions {
  defaultSeconds: number;
  maxSeconds: number;
  now?: () => number;
}

export type Backoff = ReturnType<typeof createBackoff>;

export function parseRetryAfter(value: string | null, now: number): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const at = /[a-z]/i.test(trimmed) ? Date.parse(trimmed) : NaN;
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

export function isBackoffSignal(status: number, retryAfter: string | null): boolean {
  return status === 429 || (status === 503 && Boolean(retryAfter?.trim()));
}

export function createBackoff({ defaultSeconds, maxSeconds, now = Date.now }: BackoffOptions) {
  let until = 0;

  return {
    remainingSeconds(): number {
      return Math.max(0, Math.ceil((until - now()) / 1000));
    },

    trip(retryAfter: string | null): number {
      const at = now();
      const asked = parseRetryAfter(retryAfter, at);
      const seconds = Math.min(maxSeconds, Math.max(1, asked ?? defaultSeconds));
      until = Math.max(until, at + seconds * 1000);
      return Math.ceil((until - at) / 1000);
    },
  };
}
