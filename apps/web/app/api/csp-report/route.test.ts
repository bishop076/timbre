import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { POST } from "./route.ts";

const lines: string[] = [];
const realWarn = console.warn;
console.warn = (text: string) => void lines.push(text);
afterEach(() => {
  lines.length = 0;
});
process.on("exit", () => {
  console.warn = realWarn;
});

// Its own budget is 20 a minute per client, so each case needs its own bucket.
let caller = 0;
const address = () => `10.0.0.${(caller += 1)}`;

function report(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://timbre.test/api/csp-report", {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      "content-length": String(Buffer.byteLength(body)),
      "x-real-ip": address(),
      ...headers,
    },
    body,
  });
}

const VIOLATION = JSON.stringify({
  "csp-report": { "document-uri": "https://timbre.test/", "blocked-uri": "https://evil.example/x.js" },
});

test("a violation is logged, and nothing of it is echoed", async () => {
  const response = await POST(report(VIOLATION));

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /csp_violation/);
  assert.match(lines[0]!, /evil\.example/);
});

// The cap was applied to `text.length` — after `request.text()` had already paid for the whole
// body. A 64 MB POST was buffered and discarded, in 17 seconds, against a production build.
test("a body larger than the cap is never read", async () => {
  const huge = "A".repeat(9_000);
  const request = report(huge);

  let pulled = 0;
  const body = request.body;
  const counted = body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
  const measured = new Request(request, { body: counted, duplex: "half" } as RequestInit);

  const response = await POST(measured);
  assert.equal(response.status, 204);
  assert.equal(pulled, 0, "the route pulled bytes off a body it had already decided to drop");
  assert.equal(lines.length, 0);
});

// A body that declines to say how big it is cannot be bounded before it is read, and no browser
// sends one of these without a length.
test("a report that declares no length is dropped rather than buffered", async () => {
  const response = await POST(
    new Request("http://timbre.test/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report", "x-real-ip": address() },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(VIOLATION));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit),
  );

  assert.equal(response.status, 204);
  assert.equal(lines.length, 0);
});

test("a body that is not JSON is dropped without a line", async () => {
  const response = await POST(report("not json at all"));

  assert.equal(response.status, 204);
  assert.equal(lines.length, 0);
});
