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

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const time = new Date().toISOString();
  const line: Record<string, unknown> = { level, event, time, ...fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) line[key] = describeError(value);
  }

  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ level, event, time, unserialisable: true });
  }
  console[level === "info" ? "log" : level](text);
}
