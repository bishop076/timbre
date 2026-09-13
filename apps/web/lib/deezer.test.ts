import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { deezer, deezerOrFail, DeezerUnavailable } from "./deezer.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function answering(body: unknown, init: ResponseInit = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    })) as typeof fetch;
}

function failing(cause: unknown) {
  globalThis.fetch = (async () => {
    throw cause;
  }) as typeof fetch;
}

// The shapes are the ones api.deezer.com actually returns: it answers 200 to everything and
// puts the verdict in the body.
const NO_DATA = { error: { type: "DataException", message: "no data", code: 800 } };
const BAD_PATH = { error: { type: "InvalidQueryException", message: "Unknown path", code: 600 } };
const QUOTA = { error: { type: "Exception", message: "Quota limit exceeded", code: 4 } };
const BUSY = { error: { type: "Exception", message: "Service busy", code: 700 } };

test("a real answer comes back whole", async () => {
  answering({ id: 13, name: "Eminem" });
  assert.deepEqual(await deezerOrFail("/artist/13"), { id: 13, name: "Eminem" });
});

test("'no data' is an absence, not a failure", async () => {
  answering(NO_DATA);
  assert.equal(await deezerOrFail("/artist/99999999999"), null);
});

test("a deterministic error is an absence too — retrying cannot change it", async () => {
  answering(BAD_PATH);
  assert.equal(await deezerOrFail("/nosuchendpoint"), null);
});

const failures: [string, () => void][] = [
  ["a timeout", () => failing(new DOMException("The operation timed out.", "TimeoutError"))],
  ["an unreachable host", () => failing(new TypeError("fetch failed"))],
  ["a 5xx from the edge", () => answering({}, { status: 503 })],
  ["a body that is not JSON", () => {
    globalThis.fetch = (async () => new Response("<html>maintenance</html>", { status: 200 })) as typeof fetch;
  }],
  ["being rate limited", () => answering(QUOTA)],
  ["Deezer calling itself busy", () => answering(BUSY)],
];

for (const [name, arrange] of failures) {
  test(`${name} throws rather than reading as an absence`, async () => {
    arrange();
    await assert.rejects(() => deezerOrFail("/album/1"), DeezerUnavailable);
  });

  test(`${name} still reads as an absence through the forgiving deezer()`, async () => {
    arrange();
    assert.equal(await deezer("/album/1"), null);
  });
}
