import assert from "node:assert/strict";
import { test } from "node:test";

import { publicFailures } from "@/lib/api";

import type { SongsResponse } from "./types.ts";

test("the failures the browser is typed to receive are the failures the API sends", () => {
  // The assignment is the test: `publicFailures` is what every songs route puts in the body, so
  // if this type ever again promises a field it strips, this line stops compiling.
  const sent: SongsResponse["failures"] = publicFailures([
    { source: "deezer", message: "429 — asked for “a private-sounding query”" },
  ]);

  assert.deepEqual(sent, [{ source: "deezer" }]);
  assert.equal(Object.hasOwn(sent[0]!, "message"), false);
});
