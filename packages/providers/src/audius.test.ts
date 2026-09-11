import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import type { SearchProvider } from "./types.ts";
import { AUDIUS_HOSTS, createAudiusProvider } from "./audius.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

const [PRIMARY, SECOND, THIRD] = AUDIUS_HOSTS;

const json = (value: unknown, status = 200) => Response.json(value, { status });
const found = {
  data: [{ id: "abc", title: "Delilah (Edit)", user: { name: "Someone" }, stream_conditions: null }],
};

type Answer = Response | Error | (() => Response | Error | undefined);

async function withHosts(
  table: Partial<Record<string, Answer>>,
  body: (provider: SearchProvider, asked: string[]) => Promise<void>,
): Promise<void> {
  const asked: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const host = new URL(String(input)).origin;
    asked.push(host);
    const entry = table[host];
    const answer = typeof entry === "function" ? entry() : entry;
    if (answer instanceof Error) throw answer;
    return answer ?? json(found);
  }) as typeof fetch;
  try {
    await body(createAudiusProvider(), asked);
  } finally {
    globalThis.fetch = original;
  }
}

const failsWith = (status: number) => (error: unknown) => {
  assert.ok(error instanceof ProviderError);
  assert.equal(error.status, status);
  return true;
};

test("a 5xx from the first host is answered by the next", async () => {
  await withHosts({ [PRIMARY]: json({}, 503) }, async (provider, asked) => {
    assert.equal((await provider.search!(ctx, "delilah", 5)).length, 1);
    assert.deepEqual(asked, [PRIMARY, SECOND]);
  });
});

test("a host that failed is not asked first again until its cool-down ends", async () => {
  await withHosts({ [PRIMARY]: json({}, 502) }, async (provider, asked) => {
    await provider.search!(ctx, "one", 5);
    await provider.search!(ctx, "two", 5);
    assert.deepEqual(asked, [PRIMARY, SECOND, SECOND]);
  });
});

test("a refused connection moves on too", async () => {
  const refused = { [PRIMARY]: new TypeError("fetch failed"), [SECOND]: new TypeError("getaddrinfo ENOTFOUND") };
  await withHosts(refused, async (provider, asked) => {
    const lists = await provider.radio!(ctx, { title: "Delilah", artist: "Fred again.." }, 5);
    assert.equal(lists.length, 1);
    assert.deepEqual(asked, [PRIMARY, SECOND, THIRD]);
  });
});

test("a 4xx is an answer about the request, and no other host is asked", async () => {
  for (const status of [400, 404, 429]) {
    await withHosts({ [PRIMARY]: json({}, status) }, async (provider, asked) => {
      await assert.rejects(provider.search!(ctx, "delilah", 5), failsWith(status));
      assert.deepEqual(asked, [PRIMARY], `a ${status} must not fail over`);
    });
  }
});

test("a timeout is reported at once, and the next request starts on the next host", async () => {
  const timedOut = new DOMException("The operation timed out.", "TimeoutError");
  await withHosts({ [PRIMARY]: timedOut }, async (provider, asked) => {
    await assert.rejects(provider.search!(ctx, "delilah", 5), ProviderError);
    assert.deepEqual(asked, [PRIMARY]);

    await provider.search!(ctx, "delilah", 5);
    assert.deepEqual(asked, [PRIMARY, SECOND]);
  });
});

test("every host down is one error, after each was asked once", async () => {
  const down = Object.fromEntries(AUDIUS_HOSTS.map((host) => [host, () => json({}, 503)]));
  await withHosts(down, async (provider, asked) => {
    await assert.rejects(provider.search!(ctx, "delilah", 5), failsWith(503));
    assert.deepEqual(asked, [...AUDIUS_HOSTS]);
  });
});

test("the caller's own abort is not a host failure", async () => {
  let aborted = false;
  const abortOnce = () => {
    if (aborted) return undefined;
    aborted = true;
    return new DOMException("The operation was aborted.", "AbortError");
  };

  await withHosts({ [PRIMARY]: abortOnce }, async (provider, asked) => {
    await assert.rejects(
      provider.search!(ctx, "delilah", 5),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
    assert.deepEqual(asked, [PRIMARY]);

    await provider.search!(ctx, "delilah", 5);
    assert.deepEqual(asked, [PRIMARY, PRIMARY]);
  });
});
