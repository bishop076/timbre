type LogLevel = "info" | "warn" | "error";

interface ErrorFields {
  name?: string;
  message: string;
  digest?: string;
  stack?: string[];
  cause?: string;
}

const FRAMES = 5;
const MAX_TEXT = 500;

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

  const stack = error.stack
    ?.split("\n")
    .slice(1, 1 + FRAMES)
    .map((line) => scrub(line.trim()))
    .filter(Boolean);
  const { cause } = error;

  return {
    name: error.name,
    message: scrub(error.message),
    ...(digest ? { digest } : {}),
    ...(stack?.length ? { stack } : {}),
    ...(cause === undefined
      ? {}
      : { cause: scrub(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)) }),
  };
}

const MAX_ITEMS = 20;
const MAX_DEPTH = 2;

/**
 * `scrub()` bounds a message; this bounds everything else on the line.
 *
 * Only `Error` fields were ever treated, so a plain string field went out whole — and the
 * strings this logger is handed are upstream text: a provider's error body, a resolved URL, a
 * failed query. `api.ts` remembered to scrub one of them by hand and nothing made the next
 * caller remember. Two things came of that. A search term could ride a query string into a
 * server log, which is the leak `scrub()` exists to close; and one upstream returning an HTML
 * error page could write a line thousands of characters wide, which is a different kind of
 * broken log — one nobody reads.
 *
 * Doing it here rather than at the call sites means it holds for the call site nobody has
 * written yet. The depth cap is what keeps this terminating on a cyclic field: recursion stops
 * at `MAX_DEPTH` and hands the raw value to `JSON.stringify`, which refuses it, and the line
 * falls back as it always did.
 */
function condense(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return describeError(value);
  if (typeof value === "string") return scrub(value);

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[${value.length} items]`;
    const kept = value.slice(0, MAX_ITEMS).map((item) => condense(item, depth + 1));
    return value.length > MAX_ITEMS ? [...kept, `…and ${value.length - MAX_ITEMS} more`] : kept;
  }

  if (depth < MAX_DEPTH && typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, condense(nested, depth + 1)]),
    );
  }

  return value;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const time = new Date().toISOString();

  let text: string;
  try {
    text = JSON.stringify({ level, event, time, ...(condense(fields) as object) });
  } catch {
    text = JSON.stringify({ level, event, time, unserialisable: true });
  }
  console[level === "info" ? "log" : level](text);
}
