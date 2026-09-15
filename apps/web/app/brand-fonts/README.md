# Banner fonts

Three faces used by the two places the brand is drawn rather than typed:
`app/opengraph-image.tsx` (the card a link to the site unfurls into) and
`docs/brand/banners/readme-banner.tsx` (the README banner).

| File | Face | Used for |
|---|---|---|
| `DeliciousHandrawn.woff` | Delicious Handrawn | the `tim` |
| `Gluten.woff` | Gluten | the `bre` |
| `Outfit.woff` | Outfit | the strapline |

All three are [SIL Open Font Licence 1.1](https://openfontlicense.org), which permits bundling and
redistribution, including in a repository.

They sit inside `app/` rather than in `docs/` because `opengraph-image.tsx` has to read them at
request time on Vercel, and only files Next can trace from the route make it into the serverless
bundle. Both callers load them with `new URL("./brand-fonts/…", import.meta.url)`, which is the
form Next traces — `readFileSync` off `process.cwd()` builds fine locally and 500s in production.

**Write one `new URL` per face, with a literal path. Never build the path in a template
literal.** Turbopack rewrites `new URL` + `import.meta.url` into a reference to a traced asset,
and it can only do that statically. Given `new URL(\`./brand-fonts/${file}\`, import.meta.url)`
it emits a *single* asset — whichever face it saw first — and every call then returns those same
bytes, silently. Nothing warns, the build passes, and the render comes out with all three
families in one font, because Satori falls back per glyph instead of erroring. It was found by
printing the resolved paths from inside the route: all three came back as
`.next-banner/dev/server/assets/DeliciousHandrawn.<hash>.woff`.

Because the failure is invisible in code review, check a render rather than the diff: the `bre`
must be visibly heavier and rounder than the `tim`, and the strapline must be Outfit, not
handwriting.

Nothing here reaches the browser bundle. `layout.tsx` still serves Geist for everything a visitor
sees; these are only ever rasterised into a PNG on the server.

The wordmark is deliberately two faces. The pairing, and the measured offsets that keep the `bre`
from floating above the `tim`, are explained in the comments in `docs/brand/banners/readme-banner.tsx`.
