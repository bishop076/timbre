# Banner fonts

Three faces used by the two places the brand is drawn rather than typed:
`app/opengraph-image.tsx` (the card a link to the site unfurls into) and
the README banner's drawing source.

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

Nothing here reaches the browser bundle. `layout.tsx` still serves Geist for everything a visitor
sees; these are only ever rasterised into a PNG on the server.

The wordmark is deliberately two faces. The pairing, and the measured offsets that keep the `bre`
from floating above the `tim`, are explained in the comments of the banner's drawing source.
