/*
 * One JSON line per server event, on the console — which is the whole of Timbre's error
 * tracking, deliberately.
 *
 * Vercel keeps a function's stdout and stderr, and a self-hosted container's are wherever
 * its runtime puts them. A line that is JSON can be searched by field in either place, and
 * nothing here needs an account, a key or a vendor that would then hold a record of the
 * people using the app. No `server-only` guard, for `rate-limit.ts`'s reason: that import
 * throws outside a server component, which would leave this untestable — and nothing in it
 * is secret.
 *
 * **What a line may carry is the other half of the design.** Timbre stores nothing about
 * anyone, and a log is storage. So no request bodies, headers, cookies or addresses ever
 * reach one, and query strings are cut from anything that is logged as text — a query
 * string is where a search term travels, and a search term is what someone was listening
 * for.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/** The error, reduced to what finds the fault and nothing that finds the person. */
export interface ErrorFields {
  name?: string;
  message: string;
  /** Next's hash of a server error — the same one the reader's error screen reports, so a
   * line can be matched to what somebody saw. */
  digest?: string;
  /** The first few frames. Enough to find the line; a whole stack is mostly framework. */
  stack?: string[];
  /** One level of cause, as text: a `ProviderError` wraps the socket error that explains it. */
  cause?: string;
}

const FRAMES = 5;
const MAX_TEXT = 500;

/**
 * Cuts the query string from every URL-shaped run in `text`. Anchored on a character before
 * the `?` and at least one after it, so a sentence that ends in a question mark is left as
 * it was.
 */
export function scrub(text: string): string {
  const cut = text.replace(/(\S)\?[^\s"'<>)]+/g, "$1?…");
  return cut.length > MAX_TEXT ? `${cut.slice(0, MAX_TEXT)}…` : cut;
}

export function describeError(error: unknown): ErrorFields {
  const digest =
    typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : undefined;

  if (!(error instanceof Error)) {
    return { message: scrub(String(error)), ...(digest ? { digest } : {}) };
  }

  const fields: ErrorFields = { name: error.name, message: scrub(error.message) };
  if (digest) fields.digest = digest;

  // The first line of `stack` repeats the name and message, so the frames start at the second.
  const frames = error.stack
    ?.split("\n")
    .slice(1, 1 + FRAMES)
    .map((line) => scrub(line.trim()))
    .filter(Boolean);
  if (frames?.length) fields.stack = frames;

  const cause = error.cause;
  if (cause !== undefined) {
    fields.cause = scrub(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause));
  }

  return fields;
}

/**
 * Writes one line. **Never throws**: a logger that can fail turns a reported error into an
 * unreported one, and the second is the one it was called to prevent.
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line: LogFields = { level, event, time: new Date().toISOString() };
  // An `Error` serialises as `{}`, so one passed as a field is described instead.
  for (const [key, value] of Object.entries(fields)) {
    line[key] = value instanceof Error ? describeError(value) : value;
  }

  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    // A cycle or a BigInt somewhere in the fields. The event itself is still worth a line.
    text = JSON.stringify({ level, event, time: line.time, unserialisable: true });
  }

  // Split by stream so a platform that colours stderr — Vercel does — still can.
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}
