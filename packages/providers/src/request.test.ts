import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError, type RateLimiter } from "@timbre/core";

import { createRequester } from "./request.ts";
import type { SearchContext } from "./types.ts";

/*
 * These exist because the adapters' fetch path had no coverage at all — the other
 * two suites test merging and ranking, which never issue a request. Every case
 * below is a behaviour one real source depends on, and each was previously held
 * up only by types.
 */

/** Records what was paced, so a test can assert the limiter ran before the fetch. */
function stubContext(): { ctx: SearchContext; acquired: string[] } {
  const acquired: string[] = [];
  const limiter = {
    acquire: async (key: string) => {
      acquired.push(key);
    },
  } as unknown as RateLimiter;
  return { ctx: { limiter }, acquired };
}

/** Replaces global fetch for one test and always restores it. */
async function withFetch(
  stub: (target: string | URL, init?: RequestInit) => Promise<Response>,
  body: (calls: { target: string | URL; init?: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { target: string | URL; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL, init?: RequestInit) => {
    calls.push({ target, init });
    return stub(target, init);
  }) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("a 200 hands back the parsed body, and the limiter paced it first", async () => {
  const { ctx, acquired } = stubContext();
  const get = createRequester({ id: "deezer", label: "Deezer", init: () => ({}) });

  await withFetch(
    async () => json({ data: [{ id: 1 }] }),
    async (calls) => {
      const body = await get<{ data: { id: number }[] }>(ctx, "https://api.deezer.com/chart");
      assert.deepEqual(body, { data: [{ id: 1 }] });
      assert.deepEqual(acquired, ["deezer"], "the request must be paced before it goes out");
      assert.equal(calls.length, 1);
    },
  );
});

test("an unreachable host becomes a transient error naming the source", async () => {
  const { ctx } = stubContext();
  const get = createRequester({ id: "apple", label: "Apple Music", init: () => ({}) });

  await withFetch(
    async () => {
      throw new TypeError("getaddrinfo ENOTFOUND");
    },
    async () => {
      await assert.rejects(
        () => get(ctx, "https://itunes.apple.com/search"),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.kind, "transient");
          assert.equal(error.message, "Apple Music unreachable.");
          // The original failure is kept, or a DNS problem and a refused
          // connection are indistinguishable in a log.
          assert.ok(error.cause instanceof TypeError);
          return true;
        },
      );
    },
  );
});

test("a failing status carries the status, and defaults to transient", async () => {
  const { ctx } = stubContext();
  const get = createRequester({ id: "deezer", label: "Deezer", init: () => ({}) });

  await withFetch(
    async () => json({}, 500),
    async () => {
      await assert.rejects(
        () => get(ctx, "https://api.deezer.com/chart"),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.kind, "transient");
          assert.equal(error.status, 500);
          assert.equal(error.message, "Deezer returned 500.");
          return true;
        },
      );
    },
  );
});

test("apple: 403 is a throttle, not a fault", async () => {
  // Apple's iTunes endpoint answers 403 rather than 429 when it throttles, so
  // classifying it as transient would retry into the same wall.
  const { ctx } = stubContext();
  const get = createRequester({
    id: "apple",
    label: "Apple Music",
    init: () => ({}),
    classify: (status) => (status === 403 ? "rate_limited" : "transient"),
  });

  await withFetch(
    async () => json({}, 403),
    async () => {
      await assert.rejects(
        () => get(ctx, "https://itunes.apple.com/search"),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.kind, "rate_limited");
          return true;
        },
      );
    },
  );
});

test("ytmusic: 502 is transient, anything else is unknown", async () => {
  const classify = (status: number) => (status === 502 ? "transient" : "unknown");
  const { ctx } = stubContext();
  const call = createRequester({
    id: "ytmusic",
    label: "YouTube Music sidecar",
    init: () => ({ method: "POST" }),
    classify,
  });

  for (const [status, kind] of [
    [502, "transient"],
    [418, "unknown"],
  ] as const) {
    await withFetch(
      async () => json({}, status),
      async () => {
        await assert.rejects(
          () => call(ctx, "http://127.0.0.1:8787/search"),
          (error: unknown) => {
            assert.ok(error instanceof ProviderError);
            assert.equal(error.kind, kind, `status ${status} should be ${kind}`);
            return true;
          },
        );
      },
    );
  }
});

test("ytmusic: the shared secret and method ride on every call", async () => {
  const { ctx } = stubContext();
  const call = createRequester({
    id: "ytmusic",
    label: "YouTube Music sidecar",
    init: () => ({
      method: "POST",
      headers: { "content-type": "application/json", "x-timbre-secret": "s3cret" },
      cache: "no-store",
    }),
  });

  await withFetch(
    async () => json({ tracks: [] }),
    async (calls) => {
      await call(ctx, "http://127.0.0.1:8787/search", { body: JSON.stringify({ q: "oasis" }) });
      const init = calls[0]!.init!;
      assert.equal(init.method, "POST");
      assert.equal((init.headers as Record<string, string>)["x-timbre-secret"], "s3cret");
      // The per-call argument is merged in, not swapped for the shared options.
      assert.equal(init.body, JSON.stringify({ q: "oasis" }));
      assert.equal(init.cache, "no-store");
    },
  );
});

test("soundcloud: 403 and 404 resolve to null rather than throwing", async () => {
  // A track that is private or gone is an ordinary answer for SoundCloud, not a
  // failure worth propagating — the resolver treats null as "not here".
  const { ctx } = stubContext();
  const resolve = createRequester({
    id: "soundcloud",
    label: "SoundCloud",
    init: () => ({ cache: "no-store" }),
    softStatuses: [403, 404],
  });

  for (const status of [403, 404]) {
    await withFetch(
      async () => json({}, status),
      async () => {
        assert.equal(await resolve(ctx, "https://soundcloud.com/oembed"), null);
      },
    );
  }

  // Anything else still throws, or a real outage would look like an empty result.
  await withFetch(
    async () => json({}, 500),
    async () => {
      await assert.rejects(() => resolve(ctx, "https://soundcloud.com/oembed"), ProviderError);
    },
  );
});

test("deezer: an error object in a 200 body still throws", async () => {
  // Deezer reports quota and validation failures with a 200 status, so trusting
  // response.ok would hand a caller an error object shaped like a result.
  const { ctx } = stubContext();
  const get = createRequester({
    id: "deezer",
    label: "Deezer",
    init: () => ({}),
    checkBody: (body) => {
      const error = (body as { error?: { message?: string } } | null)?.error;
      if (error) throw new ProviderError("deezer", "transient", error.message ?? "Deezer error.");
    },
  });

  await withFetch(
    async () => json({ error: { message: "Quota limit exceeded" } }),
    async () => {
      await assert.rejects(
        () => get(ctx, "https://api.deezer.com/chart"),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.message, "Quota limit exceeded");
          return true;
        },
      );
    },
  );

  // A body with no error object passes straight through.
  await withFetch(
    async () => json({ data: [] }),
    async () => {
      assert.deepEqual(await get(ctx, "https://api.deezer.com/chart"), { data: [] });
    },
  );
});

test("the caller's abort signal is passed to fetch", async () => {
  const controller = new AbortController();
  const acquired: string[] = [];
  const limiter = {
    acquire: async (key: string) => {
      acquired.push(key);
    },
  } as unknown as RateLimiter;
  const ctx: SearchContext = { limiter, signal: controller.signal };
  const get = createRequester({ id: "deezer", label: "Deezer", init: () => ({}) });

  await withFetch(
    async () => json({ data: [] }),
    async (calls) => {
      await get(ctx, "https://api.deezer.com/chart");
      assert.equal(calls[0]!.init!.signal, controller.signal);
    },
  );
});
