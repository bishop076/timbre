import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError, type RateLimiter } from "@timbre/core";

import { createRequester, deadlineSignal, type RequesterOptions } from "./request.ts";
import type { SearchContext } from "./types.ts";

const CHART = "https://api.deezer.com/chart";

function stubContext(signal?: AbortSignal): { ctx: SearchContext; acquired: string[] } {
  const acquired: string[] = [];
  const limiter = {
    acquire: async (key: string) => {
      acquired.push(key);
    },
  } as unknown as RateLimiter;
  return { ctx: { limiter, signal }, acquired };
}

async function withFetch(
  stub: () => Promise<Response>,
  body: (calls: { target: string | URL; init?: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { target: string | URL; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL, init?: RequestInit) => {
    calls.push({ target, init });
    return stub();
  }) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (value: unknown, status = 200) => Response.json(value, { status });
const requester = (options: Partial<RequesterOptions> = {}) =>
  createRequester({ id: "deezer", label: "Deezer", init: () => ({}), ...options });
const isAbortError = (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError";
const errorBody = (body: unknown) => {
  const error = (body as { error?: { message?: string } } | null)?.error;
  if (error) throw new ProviderError("deezer", "transient", error.message ?? "Deezer error.");
};
const ytmusicKinds = (status: number) => (status === 502 ? "transient" : "unknown");
const refused = new TypeError("getaddrinfo ENOTFOUND");

const failures: [string, Partial<RequesterOptions>, () => Promise<Response>, Partial<ProviderError>][] = [
  [
    "an unreachable host becomes a transient error naming the source",
    {},
    () => Promise.reject(refused),
    { kind: "transient", message: "Deezer unreachable.", cause: refused },
  ],
  [
    "a host that never answers becomes a timeout naming the source, not a hang",
    {},
    () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    { kind: "transient", message: "Deezer did not answer within 6s." },
  ],
  [
    "a slower source's own deadline is the one it reports",
    { deadlineMs: 10_000 },
    () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    { kind: "transient", message: "Deezer did not answer within 10s." },
  ],
  [
    "a failing status carries the status, and defaults to transient",
    {},
    async () => json({}, 500),
    { kind: "transient", status: 500, message: "Deezer returned 500." },
  ],
  [
    "apple: 403 is a throttle, not a fault",
    { classify: (status) => (status === 403 ? "rate_limited" : "transient") },
    async () => json({}, 403),
    { kind: "rate_limited" },
  ],
  ["ytmusic: 502 is transient", { classify: ytmusicKinds }, async () => json({}, 502), { kind: "transient" }],
  ["ytmusic: anything else is unknown", { classify: ytmusicKinds }, async () => json({}, 418), { kind: "unknown" }],
  ["soundcloud: a status outside softStatuses still throws", { softStatuses: [403, 404] }, async () => json({}, 500), { status: 500 }],
  [
    "a 200 that is not JSON is this source's error, not a raw SyntaxError",
    {},
    async () => new Response("<html>502 Bad Gateway</html>"),
    { kind: "transient", message: "Deezer returned an unreadable body." },
  ],
  [
    "deezer: an error object in a 200 body still throws",
    { checkBody: errorBody },
    async () => json({ error: { message: "Quota limit exceeded" } }),
    { message: "Quota limit exceeded" },
  ],
];

for (const [name, options, respond, expected] of failures) {
  test(name, () =>
    withFetch(respond, async () => {
      await assert.rejects(requester(options)(stubContext().ctx, CHART), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        for (const [key, value] of Object.entries(expected)) assert.equal(error[key as keyof ProviderError], value, key);
        return true;
      });
    }),
  );
}

test("a 200 hands back the parsed body, paced by the limiter first", () =>
  withFetch(
    async () => json({ data: [{ id: 1 }] }),
    async (calls) => {
      const { ctx, acquired } = stubContext();
      assert.deepEqual(await requester({ checkBody: errorBody })(ctx, CHART), { data: [{ id: 1 }] });
      assert.deepEqual(acquired, ["deezer"], "the request must be paced before it goes out");
      assert.equal(calls.length, 1);
    },
  ));

test("soundcloud: 403 and 404 resolve to null rather than throwing", async () => {
  for (const status of [403, 404]) {
    await withFetch(
      async () => json({}, status),
      async () => {
        assert.equal(await requester({ softStatuses: [403, 404] })(stubContext().ctx, CHART), null);
      },
    );
  }
});

test("ytmusic: the shared secret and method ride on every call, alongside the call's own body", () =>
  withFetch(
    async () => json({ tracks: [] }),
    async (calls) => {
      const init = (): RequestInit => ({ method: "POST", headers: { "x-timbre-secret": "s3cret" }, cache: "no-store" });
      await requester({ init })(stubContext().ctx, "http://127.0.0.1:8787/search", { body: '{"q":"oasis"}' });
      const sent = calls[0]!.init!;
      assert.deepEqual(
        [sent.method, (sent.headers as Record<string, string>)["x-timbre-secret"], sent.body, sent.cache],
        ["POST", "s3cret", '{"q":"oasis"}', "no-store"],
      );
    },
  ));

test("every request carries a deadline, and the caller's own abort still reaches fetch", () =>
  withFetch(
    async () => json({ data: [] }),
    async (calls) => {
      const controller = new AbortController();
      await requester()(stubContext().ctx, CHART);
      await requester()(stubContext(controller.signal).ctx, CHART);
      const [bare, composed] = calls.map((call) => call.init?.signal);
      assert.ok(bare, "no signal reached fetch, so nothing bounds the call");
      assert.equal(composed?.aborted, false);
      controller.abort();
      assert.equal(composed?.aborted, true, "the caller's abort must still propagate");
    },
  ));

test("the deadline fires on its own, as a TimeoutError", async () => {
  const signal = deadlineSignal(undefined, 20);
  await new Promise((resolve) => signal.addEventListener("abort", resolve));
  assert.equal((signal.reason as DOMException).name, "TimeoutError");
});

test("the caller's own abort comes back as itself, not as the source being unreachable", () =>
  withFetch(
    () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
    async () => {
      await assert.rejects(requester()(stubContext().ctx, CHART), isAbortError);
    },
  ));

test("a caller that has already aborted spends no token and makes no request", () =>
  withFetch(
    async () => json({}),
    async (calls) => {
      const { ctx, acquired } = stubContext(AbortSignal.abort());
      await assert.rejects(requester()(ctx, CHART), isAbortError);
      assert.deepEqual(acquired, [], "no token may be spent");
      assert.equal(calls.length, 0);
    },
  ));
