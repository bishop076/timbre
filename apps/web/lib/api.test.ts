import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "@timbre/core";
import { z } from "zod";

import { queryRoute } from "./api.ts";
import { DeezerUnavailable } from "./deezer.ts";

const SCHEMA = z.object({ q: z.string().min(1) });

const route = (handle: () => Promise<Response>) =>
  queryRoute(SCHEMA, "A query is required.", handle);

const ask = (handle: () => Promise<Response>, query = "q=hello") =>
  route(handle)(new Request(`http://timbre.test/api/thing?${query}`));

// Measured against a production build on :3401, with Deezer up and answering 200 throughout:
// `GET /api/artist?name=Kim%20Petras&full=1` came back `HTTP/1.1 500`, an empty body, no
// `content-type` and **no `cache-control` at all**. Nine routes stand on this wrapper and it had
// no `try` in it, so that was the answer to anything any of them threw.
test("a handler that throws is not left to the platform", async () => {
  const response = await ask(() => Promise.reject(new TypeError("Cannot read properties of undefined")));

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(((await response.json()) as { error: string }).error, /Timbre broke/);
});

// The wording is `deezerRefusal`'s, not a second one invented here: `/api/artist` and
// `/api/taste` catch this themselves and must keep saying exactly what the routes that do not
// catch it now say.
test("a Deezer refusal thrown from anywhere under a route is a 502, not a 500", async () => {
  const response = await ask(() =>
    Promise.reject(new DeezerUnavailable("/chart/132", "is rate limiting this deployment")),
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(((await response.json()) as { error: string }).error, /Deezer/);
});

test("a rate-limited provider is an outage, and says which one", async () => {
  const response = await ask(() =>
    Promise.reject(new ProviderError("spotify", "rate_limited", "429 from the token endpoint")),
  );

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = (await response.json()) as { error: string; source: string };
  assert.equal(body.source, "spotify");
  // Which source, and nothing else — the upstream's own text carries hostnames and status codes.
  assert.doesNotMatch(body.error, /429|token endpoint/);
});

// `resolveUrl` draws this line already: the ytmusic sidecar 400s every link it does not
// recognise and it is asked about every link, so counting every `ProviderError` as an outage
// would report "the service wouldn't answer" for an ordinary unsupported one.
test("a provider declining is not an outage", async () => {
  const response = await ask(() =>
    Promise.reject(new ProviderError("ytmusic", "unknown", "not a YouTube Music link")),
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a query the schema refuses is still the caller's 400, not an outage", async () => {
  const response = await ask(() => Promise.reject(new Error("never reached")), "q=");

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "A query is required." });
});

test("a handler that answers is handed straight back", async () => {
  const answer = Response.json({ ok: true }, { headers: { "cache-control": "public, s-maxage=60" } });
  const response = await ask(() => Promise.resolve(answer));

  assert.equal(response, answer, "nothing is rebuilt on the way out");
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=60");
});
