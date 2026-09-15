import assert from "node:assert/strict";
import { test } from "node:test";

import { describeError, log, scrub } from "./log.ts";

function capture(run: () => void): { stream: string; line: Record<string, unknown> }[] {
  const written: { stream: string; line: Record<string, unknown> }[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const stream of ["log", "warn", "error"] as const) {
    console[stream] = (text: string) => written.push({ stream, line: JSON.parse(text) });
  }
  try {
    run();
  } finally {
    Object.assign(console, original);
  }
  return written;
}

test("one event is one JSON line, on the stream its level belongs to", () => {
  const written = capture(() => {
    log("warn", "rate_limited", { route: "/api/search", retryAfterSeconds: 12 });
    log("error", "request_error", { route: "/artist/[name]" });
    log("info", "started");
  });

  assert.deepEqual(
    written.map(({ stream, line }) => [stream, line.level, line.event]),
    [
      ["warn", "warn", "rate_limited"],
      ["error", "error", "request_error"],
      ["log", "info", "started"],
    ],
  );
  assert.equal(written[0]!.line.retryAfterSeconds, 12);
  assert.equal(typeof written[0]!.line.time, "string");
});

test("a query string is cut, because that is where a search term travels", () => {
  assert.equal(
    scrub("fetch failed for https://api.deezer.com/search?q=someone%27s+song&limit=5"),
    "fetch failed for https://api.deezer.com/search?…",
  );
  assert.equal(scrub("GET /api/search?q=secret failed"), "GET /api/search?… failed");
  assert.equal(scrub("Is the sidecar up? No."), "Is the sidecar up? No.");
});

test("an error is described by name, scrubbed message, digest, a few frames and its cause", () => {
  const cause = new TypeError("getaddrinfo ENOTFOUND api.audius.co");
  const error = Object.assign(new Error("Audius unreachable at https://api.audius.co/v1/tracks/search?query=x", { cause }), {
    digest: "2863947392",
  });

  const described = describeError(error);
  assert.equal(described.name, "Error");
  assert.equal(described.message, "Audius unreachable at https://api.audius.co/v1/tracks/search?…");
  assert.equal(described.digest, "2863947392");
  assert.equal(described.cause, "TypeError: getaddrinfo ENOTFOUND api.audius.co");
  assert.ok(described.stack && described.stack.length > 0 && described.stack.length <= 5);
  assert.ok(
    !described.stack.some((frame) => frame.includes("Audius unreachable")),
    "the first stack line repeats the message and is not a frame",
  );
});

test("an Error passed as a field is described rather than serialised as {}", () => {
  const written = capture(() => log("warn", "radio_failed", { error: new RangeError("nope") }));
  const error = written[0]!.line.error as { name: string; message: string };
  assert.equal(error.name, "RangeError");
  assert.equal(error.message, "nope");
});

test("a thrown non-Error is still a message", () => {
  assert.deepEqual(describeError("plain string"), { message: "plain string" });
  assert.deepEqual(describeError({ digest: "123" }), { message: "[object Object]", digest: "123" });
});

test("fields that cannot be serialised cost the fields, not the line", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;

  const written = capture(() => {
    assert.doesNotThrow(() => log("error", "request_error", { cycle }));
  });
  assert.equal(written[0]!.line.event, "request_error");
  assert.equal(written[0]!.line.unserialisable, true);
});

test("a string field is scrubbed and bounded, not just a message", () => {
  const written = capture(() =>
    log("warn", "upstream_failed", {
      source: "deezer",
      url: "https://api.deezer.com/search?q=someone%27s+song",
      body: "x".repeat(900),
    }),
  );

  const line = written[0]!.line;
  assert.equal(line.url, "https://api.deezer.com/search?…");
  assert.equal((line.body as string).length, 501, "500 characters and the ellipsis");
  assert.equal(line.source, "deezer");
});

test("a nested field is condensed as well, and a long list is capped", () => {
  const written = capture(() =>
    log("warn", "lyrics_upstream_failed", {
      alternatives: Array.from({ length: 25 }, (_, index) => `track?id=${index}`),
      attempt: { url: "https://lrclib.net/api/get?track_name=x", tries: 3 },
    }),
  );

  const line = written[0]!.line;
  const alternatives = line.alternatives as string[];
  assert.equal(alternatives.length, 21, "twenty kept plus the tally");
  assert.equal(alternatives[0], "track?…");
  assert.equal(alternatives.at(-1), "…and 5 more");

  const attempt = line.attempt as { url: string; tries: number };
  assert.equal(attempt.url, "https://lrclib.net/api/get?…");
  assert.equal(attempt.tries, 3, "a number is left alone");
});
