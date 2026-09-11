// An upstream's own "not now", remembered. `rate-limit.ts` meters what arrives at Timbre; this
// holds what a third party said about what leaves it. Every reader's lyrics lookup reaches
// LRCLIB from one address under one User-Agent (docs/EXPOSURE.md E-18), so a 429 is addressed
// to the whole deployment, and a route that keeps asking through it turns one refusal into a
// block. Per instance and in memory, like the limiters: an instance that has not been told
// yet finds out on its first call, which costs one request. No `server-only` guard, so the
// logic stays testable.

export interface BackoffOptions {
  /** The hold when a refusal names no time, or one that cannot be read. */
  defaultSeconds: number;
  /** Ceiling on any one hold, so a misread header cannot silence the source for a day. */
  maxSeconds: number;
  now?: () => number;
}

export interface Backoff {
  /** Whole seconds until calls may go out again; 0 when they may. */
  remainingSeconds(): number;
  /** Records a refusal and its `Retry-After`. Returns the seconds now being waited out. */
  trip(retryAfter: string | null): number;
}

/**
 * `Retry-After` in seconds, or null when absent or unreadable. The header is either a count
 * of seconds or an HTTP date (RFC 9110 §10.2.3); both forms are in use, so both are read. A
 * date already past is zero rather than negative.
 *
 * A date must name its month or day in words, as every HTTP-date form does. `Date.parse` is
 * lenient enough to read "1.5" or "-5" as dates in the distant past, which would turn a
 * garbled header into "retry now" rather than into the default hold.
 */
export function parseRetryAfter(value: string | null, now: number): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (!/[a-z]/i.test(trimmed)) return null;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * Whether a response is an instruction to back off. A 429 always is. A 503 is only when it
 * says when to come back — that is the same instruction — while a bare 503 is an outage, and
 * treating it as a hold would stretch a blip into a default-length silence.
 */
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
      // At least a second: a refusal that says "retry now" was still a refusal, and asking
      // again in the same instant is the hot loop the header exists to prevent.
      const seconds = Math.min(maxSeconds, Math.max(1, asked ?? defaultSeconds));
      // Extended, never shortened. Concurrent lookups each see the 429; a later one naming a
      // shorter wait must not cut the hold an earlier one was given.
      until = Math.max(until, at + seconds * 1000);
      return Math.ceil((until - at) / 1000);
    },
  };
}
