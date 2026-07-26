# Credits

Timbre's visual language draws on two open-source music players. Both are MIT
licensed, which permits reuse provided the copyright notice is retained — this
file, plus the header comment in `apps/web/app/globals.css`, is that notice.

## YesPlayMusic

<https://github.com/qier222/YesPlayMusic> — MIT, Copyright (c) 2020 qier222

**Adapted:** the colour palette and typeface.

- `#335eea` as the primary accent
- `#222222` as the dark background rather than a near-black, and `#323232` for
  raised surfaces. Warmer than most dark themes, and album art sits better on it
- `#7a7a7b` for secondary text in both themes
- Translucent navigation bars at 0.86 alpha
- **Barlow** as the interface typeface

No code was copied. YesPlayMusic is Vue; Timbre is React, so nothing would
transfer directly even if it were wanted.

## AlgerMusicPlayer

<https://github.com/algerkong/AlgerMusicPlayer> — MIT

**Adapted:** two surface techniques.

- `backdrop-filter: blur(16px) saturate(1.8)` — the saturation is what keeps
  blurred artwork behind a frosted bar from going grey
- A layered shadow of a soft drop plus a hairline ring, so raised surfaces read
  as lifted rather than merely shaded

Its stylesheet is largely overrides for Naive UI, which Timbre does not use, so
only the techniques carried across.

## nuclear — deliberately not used

<https://github.com/nukeop/nuclear> — **AGPL-3.0**

Nothing from nuclear appears in Timbre, by design. AGPL-3.0 is strong copyleft:
incorporating any of it would oblige Timbre to be AGPL-3.0 as well, and because
AGPL covers network use, a hosted Timbre would have to offer its complete source
to every visitor. That would make the repository necessarily public and permit
anyone to take and rehost it.

It remains worth studying as a reference for what a multi-source free music
player can be.

## Everything else

The layout — sidebar navigation, scrolling content, persistent bottom player bar
— is the common vocabulary of music applications rather than any one project's
invention. Icons in `apps/web/app/icons.tsx` are hand-drawn for Timbre.
