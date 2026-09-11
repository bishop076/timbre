export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface ErrorFields {
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

  const fields: ErrorFields = { name: error.name, message: scrub(error.message) };
  if (digest) fields.digest = digest;

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

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line: LogFields = { level, event, time: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    line[key] = value instanceof Error ? describeError(value) : value;
  }

  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ level, event, time: line.time, unserialisable: true });
  }

  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}
