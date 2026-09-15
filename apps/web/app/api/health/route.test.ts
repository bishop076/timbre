import assert from "node:assert/strict";
import { test } from "node:test";

// `getEnv` caches its first successful parse, and the schema is read at call time — so the
// variable has to be gone before the route is ever asked. Node runs each test file in its own
// process, which is what makes this safe to do to the environment.
delete process.env.YTMUSIC_SHARED_SECRET;

const { GET } = await import("./route.ts");

test("a deployment whose environment does not parse still answers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("the suite must never leave the machine");
  }) as unknown as typeof fetch;

  try {
    const response = await GET(new Request("http://timbre.test/api/health"));

    // Without this the throw escapes the handler: a 500 with whatever body the platform
    // chooses, from the route an operator reaches for when nothing else works.
    assert.equal(response.status, 503);
    const body = (await response.json()) as { status: string; detail: string };
    assert.equal(body.status, "error");
    assert.equal(body.detail, "configuration invalid");
    assert.doesNotMatch(body.detail, /YTMUSIC/, "variable names belong in the log, not the body");
  } finally {
    globalThis.fetch = original;
  }
});
