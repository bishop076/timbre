import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import { AUDIUS_HOSTS, createAudiusProvider } from "./audius.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

const [PRIMARY, SECOND, THIRD, FOURTH] = AUDIUS_HOSTS;

const found = {
  data: [{ id: "abc", title: "Delilah (Edit)", user: { name: "Someone" }, stream_conditions: null }],
};

type Answer = Response | Error | (() => Response | Error | undefined);

async function withHosts(
  table: Partial<Record<string, Answer>>,
  body: (asked: string[]) => Promise<void>,
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
    await body(asked);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("a 5xx from the first host is answered by the next", async () => {
  const provider = createAudiusProvider();

  await withHosts({ [PRIMARY]: json({}, 503) }, async (asked) => {
    const tracks = await provider.search!(ctx, "delilah", 5);
    assert.equal(tracks.length, 1);
    assert.deepEqual(asked, [PRIMARY, SECOND]);
  });
});

test("a host that failed is not asked first again until its cool-down ends", async () => {
  const provider = createAudiusProvider();

  await withHosts({ [PRIMARY]: json({}, 502) }, async (asked) => {
    await provider.search!(ctx, "one", 5);
    await provider.search!(ctx, "two", 5);
    assert.deepEqual(asked, [PRIMARY, SECOND, SECOND]);
  });
});

test("a refused connection moves on too", async () => {
  const provider = createAudiusProvider();

  await withHosts(
    { [PRIMARY]: new TypeError("fetch failed"), [SECOND]: new TypeError("getaddrinfo ENOTFOUND") },
    async (asked) => {
      const lists = await provider.radio!(ctx, { title: "Delilah", artist: "Fred again.." }, 5);
      assert.equal(lists.length, 1);
      assert.deepEqual(asked, [PRIMARY, SECOND, THIRD]);
    },
  );
});

test("a 4xx is an answer about the request, and no other host is asked", async () => {
  for (const status of [400, 404, 429]) {
    const provider = createAudiusProvider();
    await withHosts({ [PRIMARY]: json({}, status) }, async (asked) => {
      await assert.rejects(provider.search!(ctx, "delilah", 5), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.status, status);
        return true;
      });
      assert.deepEqual(asked, [PRIMARY], `a ${status} must not fail over`);
    });
  }
});

test("a timeout is reported at once, and the next request starts on the next host", async () => {
  const provider = createAudiusProvider();
  const timedOut = new DOMException("The operation timed out.", "TimeoutError");

  await withHosts({ [PRIMARY]: timedOut }, async (asked) => {
    await assert.rejects(provider.search!(ctx, "delilah", 5), ProviderError);
    assert.deepEqual(asked, [PRIMARY]);

    await provider.search!(ctx, "delilah", 5);
    assert.deepEqual(asked, [PRIMARY, SECOND]);
  });
});

test("every host down is one error, after each was asked once", async () => {
  const provider = createAudiusProvider();
  const down = json({}, 503);

  await withHosts(
    { [PRIMARY]: down.clone(), [SECOND]: down.clone(), [THIRD]: down.clone(), [FOURTH]: down.clone() },
    async (asked) => {
      await assert.rejects(provider.search!(ctx, "delilah", 5), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.status, 503);
        return true;
      });
      assert.deepEqual(asked, [...AUDIUS_HOSTS]);
    },
  );
});

test("the caller's own abort is not a host failure", async () => {
  const provider = createAudiusProvider();

  let aborted = false;
  const abortOnce = () => {
    if (aborted) return undefined;
    aborted = true;
    return new DOMException("The operation was aborted.", "AbortError");
  };

  await withHosts(
    { [PRIMARY]: abortOnce },
    async (asked) => {
      await assert.rejects(
        provider.search!(ctx, "delilah", 5),
        (error: unknown) => error instanceof DOMException && error.name === "AbortError",
      );
      assert.deepEqual(asked, [PRIMARY]);

      await provider.search!(ctx, "delilah", 5);
      assert.deepEqual(asked, [PRIMARY, PRIMARY]);
    },
  );
});
