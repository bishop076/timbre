import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { DEFAULT_POLICIES, MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import { MAX_BODY_BYTES, createRequester, deadlineSignal, readCapped, takeSlot, type RequesterOptions } from "./request.ts";
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
  stub: (init?: RequestInit) => Promise<Response>,
  body: (calls: { target: string | URL; init?: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { target: string | URL; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL, init?: RequestInit) => {
    calls.push({ target, init });
    return stub(init);
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

/**
 * A body that never ends, in chunks, exactly as `fetch` would deliver one.
 *
 * `sent` counts what the source actually managed to write, which is the assertion that matters:
 * a cap that let the whole body arrive and then complained would have bounded nothing.
 */
function endlessBody(chunk = 64 * 1024): { response: () => Response; sent: () => number } {
  const block = new Uint8Array(chunk).fill(0x20);
  let sent = 0;
  return {
    sent: () => sent,
    response: () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            sent += block.byteLength;
            controller.enqueue(block.slice());
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  };
}

test("a source that never stops sending is cut off, and said so, rather than filling the heap", () => {
  const endless = endlessBody();
  return withFetch(
    async () => endless.response(),
    async () => {
      await assert.rejects(requester()(stubContext().ctx, CHART), (error: unknown) => {
        assert.ok(error instanceof ProviderError, "the cap must be this source's failure, not a raw one");
        assert.equal(error.provider, "deezer");
        assert.equal(error.kind, "transient");
        assert.equal(error.message, "Deezer sent more than 4 MB; the read was stopped.");
        return true;
      });
      // Near the cap rather than exactly on it: the stream keeps one chunk in hand, so the
      // count lands a chunk or two past the line. What matters is that it lands at all.
      const stopped = endless.sent();
      assert.ok(stopped < MAX_BODY_BYTES * 1.1, `the read ran past the cap: ${stopped} bytes arrived`);
      await sleep(20);
      assert.equal(endless.sent(), stopped, "the source must be cancelled, not left writing");
    },
  );
});

test("an oversized body is not quietly truncated into a parse failure", () =>
  // The failure has to name the size. A truncated body that then fails `JSON.parse` reports
  // itself as "Deezer returned an unreadable body", which sends the reader after a malformed
  // answer that was never malformed.
  withFetch(
    async () => new Response(`{"data":[{"pad":"${"x".repeat(2000)}"}]}`),
    async () => {
      await assert.rejects(requester({ maxBytes: 1024 })(stubContext().ctx, CHART), {
        kind: "transient",
        message: "Deezer sent more than 1 KB; the read was stopped.",
      });
    },
  ));

test("a body inside the cap is still read whole, multi-byte characters included", async () => {
  const value = "é".repeat(200_000);
  const text = await readCapped(new Response(JSON.stringify({ value })), "deezer", "Deezer");
  assert.equal((JSON.parse(text) as { value: string }).value, value);
  assert.equal(await readCapped(new Response(null, { status: 204 }), "deezer", "Deezer"), "");
});

test("a slot taken outside a requester is refused as rate_limited, not waited for", async () => {
  const limiter = { acquire: async () => false } as unknown as RateLimiter;
  await assert.rejects(takeSlot({ limiter }, "spotify", "MusicBrainz", { key: "musicbrainz" }), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.kind, "rate_limited");
    assert.equal(error.message, "MusicBrainz has no free request slot within 6s.");
    return true;
  });
});

test("the deadline fires on its own, as a TimeoutError", async () => {
  const signal = deadlineSignal(undefined, 20);
  await sleep(60);
  assert.equal(signal.aborted, true);
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

const drained = async (limiter: RateLimiter) => {
  for (let i = 0; i < DEFAULT_POLICIES.deezer.capacity; i++) await requester()({ limiter }, CHART);
};

test("a source whose next slot is past its deadline is refused at once as rate-limited, not queued", () =>
  withFetch(
    async () => json({}),
    async (calls) => {
      const limiter = new RateLimiter(new MemoryBucketStore(), () => 0);
      await drained(limiter);
      await assert.rejects(requester({ deadlineMs: 20 })({ limiter }, CHART), {
        kind: "rate_limited",
        provider: "deezer",
        message: "Deezer has no free request slot within 0.01s.",
      });
      assert.equal(calls.length, DEFAULT_POLICIES.deezer.capacity, "a refused request must not go out");
    },
  ));

test("the wait for a slot counts against the deadline, and is blamed on the queue", () =>
  withFetch(
    (init) => (init?.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(json({}))),
    async (calls) => {
      const limiter = { acquire: () => sleep(40) } as unknown as RateLimiter;
      // The budget is still shared — a slow queue still ends the attempt. But it ends as rate
      // limiting rather than as "the provider did not answer", which was a claim about a
      // request that was never sent.
      await assert.rejects(requester({ deadlineMs: 20 })({ limiter }, CHART), {
        kind: "rate_limited",
        message: "Deezer's queue used the whole 0.02s before the request could be sent.",
      });
      assert.equal(calls.length, 0, "nothing is sent once the budget is gone");
    },
  ));

// Real time is what made this flaky, the same way it did in `limiter.test.ts`. The drained
// bucket makes the limiter sleep a real 125ms, and this test used to sleep a real 5ms of its
// own before aborting — so any stall longer than the limiter's wait (a loaded machine running
// the suites in parallel, a GC pause) let the slot come round first: the request went out,
// `waiting` resolved, and both assertions below failed. Mocking `setTimeout` takes elapsed time
// out of it, so the wait cannot end unless this test ends it, and the abort always wins.
test("a caller that aborts while waiting for a slot leaves at once, without a request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withFetch(
    async () => json({}),
    async (calls) => {
      const limiter = new RateLimiter(new MemoryBucketStore(), () => 0);
      await drained(limiter);
      const controller = new AbortController();
      const waiting = requester()({ limiter, signal: controller.signal }, CHART);

      // `acquire` serialises through several awaits before it reaches its wait; let those
      // microtasks settle. With the timer mocked there is nothing this can drain too far.
      for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setImmediate(resolve));
      controller.abort();

      await assert.rejects(waiting, isAbortError);
      assert.equal(calls.length, DEFAULT_POLICIES.deezer.capacity);
    },
  );
});
