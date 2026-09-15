# Type

The wordmark is **two faces**, not one. That is the design, not an accident of a missing font.

| Part | Face | Licence |
|---|---|---|
| `tim` | **Delicious Handrawn** | SIL OFL 1.1 |
| `bre` | **Gluten** | SIL OFL 1.1 |
| strapline | **Outfit** | SIL OFL 1.1 |

The `bre` must read visibly **heavier and rounder** than the `tim`. If it does not, the render is
broken — see the font-tracing bug in [`../../../apps/web/app/brand-fonts/README.md`](../../../apps/web/app/brand-fonts/README.md),
which produced a plausible-looking banner with all three families rendered in one font and nothing
warning about it.

## The measured numbers

Do not eyeball these. They were got wrong three times by judgement and then measured off rendered
pixels:

```
HEAD_TRACK = -0.02    letter-spacing on "tim", as a fraction of the head size
BRE_SCALE  = 0.94     "bre" font size, as a fraction of the head size
BRE_DROP   = 0.209    "bre" marginTop, as a fraction of the head size
```

Delicious Handrawn sits high on its line. On a shared baseline the `bre` hangs **13px above** the
foot of the `m`. Dropping it by 0.209 puts the feet level, with the round `b` and `e` 2px past —
the overshoot round letters are supposed to have.

**Scale and drop move together**, linearly, at about 11px per 0.1 of drop at a 126px head size.
Change one and you must re-measure the other.

Alignment is `flex-start` + `marginTop`, **not** `baseline` + `marginBottom`. Satori ignores
`marginBottom` under baseline alignment: rendering at drop 0 and drop 0.2 gives pixel-identical
output, so the obvious spelling of this silently does nothing.

## Where the files live

The `.woff` files are **not** here. They are in
[`apps/web/app/brand-fonts/`](../../../apps/web/app/brand-fonts/) because `app/opengraph-image.tsx`
has to read them at request time on Vercel, and only files Next can trace from a route make it into
the serverless bundle. Moving them here would 500 the link card in production. That directory's
README explains the tracing rule in full.

None of these faces reach the browser bundle. `layout.tsx` serves Geist to visitors; these are only
ever rasterised into a PNG on the server.

## The strapline

> a music player for people who don't pay for streaming

Outfit, 22px, `letter-spacing: 1`, `#e7dcff`, set on two lines. This one describes the product.
The earlier **"one search box, one queue"** described the search box instead, and was retired with
the turntable banner.
