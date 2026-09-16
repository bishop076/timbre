import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

// Two things stand between `node --test` and a page module, and both are resolution rather
// than logic. `next` publishes no `exports` map and no extension on its subpaths, so Node
// cannot follow `next/navigation` at all; and `ArtistView` is a client component that pulls in
// half the player, none of which this file is about. Both are answered with a stub, which is
// also what makes the assertions readable: the page returns an element, so whatever `ArtistView`
// turns out to be, `element.props` is the page.
const STUB = (name: string) =>
  `data:text/javascript,export function ${name}(){return null}`;

// `registerHooks` landed in Node 22.15 and `@types/node` is pinned at 20 here, so it is reached
// through `require` rather than fought with a cast on the import.
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
    const shim: Record<string, string> = {
      "next/navigation": "data:text/javascript,export function notFound(){throw new Error('NEXT_NOT_FOUND')}",
      "../artist-view": STUB("ArtistView"),
      "../artist-about": STUB("ArtistAbout"),
    };
    const url = shim[specifier];
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});

const { default: ArtistPage } = (await import("./[name]/page.tsx")) as {
  default: (props: { params: Promise<{ name: string }> }) => Promise<{ props: ViewProps }>;
};

// The page is a server component that returns an element, so its props are the page: the name
// in the heading, the picture, the follower count and the "Open on Deezer" link all come from
// one object. Asserting on them is asserting on what a reader sees, without a DOM.
interface ViewProps {
  query: string;
  name: string;
  imageUrl: string | null;
  followers: number | null;
  sourceUrl: string | null;
}

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/** Answers only the paths given, and fails the test on any other call — nothing reaches the network. */
function serving(routes: Record<string, unknown>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = Object.keys(routes).find((path) => `${url.pathname}${url.search}`.startsWith(path));
    assert.ok(key, `unexpected request to ${url.pathname}${url.search}`);
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const render = async (slug: string): Promise<ViewProps> =>
  (await ArtistPage({ params: Promise.resolve({ name: slug }) })).props;

// What `api.deezer.com/search/artist?q=pump glock` actually answers: the SoundCloud uploader is
// not in Deezer's catalogue, and Deezer's loose artist search hands back a band that merely
// shares a word. `findArtist` seeds its reducer with the first result, so it returns this one
// however badly it scores.
const BLACK_PUMAS = {
  data: [
    {
      name: "Black Pumas",
      nb_fan: 106_373,
      picture_xl: "https://cdn-images.dzcdn.net/images/artist/black-pumas/1000x1000.jpg",
      link: "https://www.deezer.com/artist/12578442",
    },
  ],
};

test("a name Deezer only guessed at does not become somebody else's page", async () => {
  serving({ "/search/artist": BLACK_PUMAS });

  const page = await render("pump-glock");

  assert.equal(page.name, "Pump Glock", "the heading claimed a band nobody asked for");
  assert.equal(page.imageUrl, null, "another band's photograph");
  assert.equal(page.followers, null, "another band's follower count");
  assert.equal(page.sourceUrl, null, "a link to another band on Deezer");
  // The songs are still searched for under the name that was asked for — that part was never
  // wrong, and it is the whole answer this page can honestly give.
  assert.equal(page.query, "pump glock");
});

test("the artist a slug really does name still gets their own page", async () => {
  serving({
    "/search/artist": {
      data: [
        {
          name: "Björk",
          nb_fan: 865_968,
          picture_xl: "https://cdn-images.dzcdn.net/images/artist/bjork/1000x1000.jpg",
          link: "https://www.deezer.com/artist/145",
        },
      ],
    },
    "/artist/145/albums": { data: [{ id: 7, title: "Homogenic", release_date: "1997-09-22" }] },
    "/artist/145/related": { data: [] },
  });

  // A slug is lossy on purpose — "bjork" is what a URL can carry — so the comparison has to be
  // as forgiving as `toArtistSlug` is, or every accented name would lose its own page.
  const page = await render("bjork");

  assert.equal(page.name, "Björk");
  assert.equal(page.followers, 865_968);
  assert.equal(page.sourceUrl, "https://www.deezer.com/artist/145");
});
