# Banner fonts

Three faces, vendored because `docs/assets/readme-banner.tsx` needs the bytes at draw time and a
banner whose fonts are fetched from a CDN stops being redrawable the day that CDN moves.

| File | Face | Used for |
|---|---|---|
| `DeliciousHandrawn.woff` | Delicious Handrawn | the `tim` |
| `Gluten.woff` | Gluten | the `bre` |
| `Outfit.woff` | Outfit | the strapline |

All three are [SIL Open Font Licence 1.1](https://openfontlicense.org), which permits bundling and
redistribution, including in a repository. They are not loaded by the app — `layout.tsx` still uses
Geist for everything the browser sees, and nothing here reaches the bundle.

The wordmark is deliberately two faces. The pairing, and the measured offsets that keep the `bre`
from floating above the `tim`, are explained in the comments in `readme-banner.tsx`.
