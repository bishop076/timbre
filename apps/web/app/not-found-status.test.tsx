import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, test } from "node:test";

/**
 * `notFound()` answering 200.
 *
 * A `loading.tsx` wraps its segment's page in a Suspense boundary, and the shell of that
 * boundary is what Next serves — status line and all — before the page underneath has resolved.
 * A `notFound()` raised inside the page therefore arrived too late to be a 404: every missing
 * album, artist and collection answered "200 OK" with the not-found panel streamed in behind it.
 * A reader saw the right words; a crawler, a link checker and an uptime monitor saw a success,
 * and on a `force-static` route that 200 was then kept in the ISR entry for the full revalidate
 * window.
 *
 * The fix is a `layout.tsx` per segment, which sits outside its own segment's Suspense boundary
 * and so decides absence before the first byte. These tests are about that decision: what counts
 * as absent, what does not, and that no future route quietly loses the layout again.
 */

const NOT_FOUND = "NEXT_NOT_FOUND";

type Resolve = (
  specifier: string,
  context: unknown,
  next: (specifier: string, context: unknown) => unknown,
) => unknown;

const { registerHooks } = createRequire(import.meta.url)("node:module") as {
  registerHooks: (hooks: { resolve: Resolve }) => void;
};

registerHooks({
  resolve(specifier, context, next) {
    return specifier === "next/navigation"
      ? {
          url: `data:text/javascript,export function notFound(){throw new Error('${NOT_FOUND}')}`,
          shortCircuit: true,
        }
      : next(specifier, context);
  },
});

type Layout = (props: {
  children: string;
  params: Promise<Record<string, string>>;
}) => Promise<unknown>;

const { default: AlbumLayout } = (await import("./album/[id]/layout.tsx")) as { default: Layout };
const { default: ArtistLayout } = (await import("./artist/[name]/layout.tsx")) as {
  default: Layout;
};
const { default: CollectionLayout } = (await import("./collection/[kind]/[id]/layout.tsx")) as {
  default: Layout;
};

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/** Deezer answers 200 to everything and puts the verdict in the body — see lib/deezer.ts. */
function deezerAnswers(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function nothingIsAsked() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.fail(`the layout reached out to ${String(input)} to answer a question in the address`);
  }) as typeof fetch;
}

const render = (layout: Layout, params: Record<string, string>) =>
  layout({ children: "the page", params: Promise.resolve(params) });

const missing = async (layout: Layout, params: Record<string, string>) =>
  assert.rejects(() => render(layout, params), new RegExp(NOT_FOUND));

// Deezer error code 800: "no data" — the one code that means the thing genuinely is not there.
const NO_SUCH_THING = { error: { code: 800, message: "no data" } };

test("an album Deezer has no release for is an absence, decided above the page", async () => {
  deezerAnswers(NO_SUCH_THING);
  await missing(AlbumLayout, { id: "999999999999" });
});

test("an id that is not a number never reaches Deezer, and is still an absence", async () => {
  nothingIsAsked();
  await missing(AlbumLayout, { id: "not-an-id" });
});

test("an album that exists lets the page through", async () => {
  deezerAnswers({ id: 302127, title: "Discovery", artist: { name: "Daft Punk" }, nb_tracks: 14 });
  assert.equal(await render(AlbumLayout, { id: "302127" }), "the page");
});

test("Deezer failing to answer is not an absence — that belongs to error.tsx", async () => {
  // A timeout read as "no such album" would be cached as one for the hour this route revalidates
  // on, which is the trade lib/deezer.ts's `deezerOrFail` exists to refuse.
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(await render(AlbumLayout, { id: "302127" }), "the page");
});

test("a slug that unpicks to no name at all is an absence", async () => {
  nothingIsAsked();
  await missing(ArtistLayout, { name: "-" });
});

test("a real artist slug lets the page through", async () => {
  nothingIsAsked();
  assert.equal(await render(ArtistLayout, { name: "daft-punk" }), "the page");
});

test("a kind of collection Timbre does not serve is an absence, asked of nobody", async () => {
  nothingIsAsked();
  await missing(CollectionLayout, { kind: "nosuchkind", id: "1" });
});

test("a genre Deezer has nothing for is an absence", async () => {
  deezerAnswers(NO_SUCH_THING);
  await missing(CollectionLayout, { kind: "genre", id: "999999999" });
});

/**
 * The structural half: a new route can reintroduce the 200 simply by adding a `loading.tsx` and
 * calling `notFound()` from the page, which is exactly how the three above came to have it.
 */
test("every page that calls notFound() decides it above the nearest loading.tsx", () => {
  const app = import.meta.dirname;

  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx" && /\bnotFound\(/.test(readFileSync(full, "utf8"))) {
        pages.push(full);
      }
    }
  };
  walk(app);
  assert.ok(pages.length > 0, "no page calls notFound() — this test has stopped testing anything");

  for (const page of pages) {
    const relative = path.relative(app, path.dirname(page));
    const segments = relative ? relative.split(path.sep) : [];
    const chain = segments.map((_, index) => path.join(app, ...segments.slice(0, index + 1)));

    const has = (dir: string, file: string) => {
      try {
        return statSync(path.join(dir, file)).isFile();
      } catch {
        return false;
      }
    };

    const boundary = chain.findIndex((dir) => has(dir, "loading.tsx"));
    if (boundary === -1) continue;

    const decider = chain
      .slice(boundary)
      .find((dir) => has(dir, "layout.tsx") && /\bnotFound\(/.test(readFileSync(path.join(dir, "layout.tsx"), "utf8")));

    assert.ok(
      decider,
      `${path.relative(app, page)} calls notFound() under the Suspense boundary that ` +
        `${path.relative(app, chain[boundary]!)}/loading.tsx creates, so it answers 200. ` +
        `A layout.tsx at or below that segment has to make the call instead.`,
    );
  }
});

/**
 * And the other half of that arrangement: a layout is outside its own segment's `not-found.tsx`,
 * so a boundary left beside the layout that raises `notFound()` is simply never reached and the
 * root panel answers in its place — which is how "That album isn't on Deezer" briefly became
 * "There is nothing at this address".
 */
test("the not-found copy for a segment sits above the layout that raises it", () => {
  const app = import.meta.dirname;

  const deciders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "layout.tsx" && /\bnotFound\(/.test(readFileSync(full, "utf8"))) {
        deciders.push(path.dirname(full));
      }
    }
  };
  walk(app);
  assert.ok(deciders.length > 0, "no layout decides an absence — this test has stopped testing");

  for (const dir of deciders) {
    let above = path.dirname(dir);
    let found = false;
    while (above.startsWith(app) && above !== app) {
      try {
        found = statSync(path.join(above, "not-found.tsx")).isFile();
      } catch {
        found = false;
      }
      if (found) break;
      above = path.dirname(above);
    }
    assert.ok(
      found,
      `${path.relative(app, dir)}/layout.tsx raises notFound() with no not-found.tsx above it, ` +
        `so the root panel answers instead of this route's own words.`,
    );
  }
});
