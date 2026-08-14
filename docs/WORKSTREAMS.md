# Workstreams

Two agents are working on Timbre at once. This is who owns what, so neither
overwrites the other's file mid-edit.

**Read the first section before writing any code.** It records an architectural
change that invalidates assumptions the rest of the repo used to be built on.

---

## ⚠️ Architecture changed: there is no server-side data

*2026-08-16.* Timbre now stores **nothing** about anyone. This was a deliberate
decision driven by hosting cost — see the reasoning below — and it deleted a
large amount of code that other work may still assume exists.

| Gone | Replaced by |
| :--- | :--- |
| Postgres, `packages/db`, all migrations | nothing — no database at all |
| Auth.js, `auth.ts`, `/signin`, `/api/auth/*` | no accounts, no sign-in |
| `users` / `sessions` / `playlists` tables | `localStorage` |
| `/api/playlists`, `/api/me`, `lib/playlists.ts`, `lib/profile.ts` | client stores |
| `proxy.ts` (route protection) | nothing to protect |
| `docker-compose.yml` (Postgres + Mailpit) | no services to run |

**Why:** accounts need an SMTP provider in production to deliver magic links,
and a database that stays alive to hold an email and a session. Both cost money
or an account. Dropping them makes the app free to host on Vercel hobby with the
sidecar on a free tier, and leaves no personal data to protect.

**What this means when writing code now:**

- There is no `getDatabase()`, no `auth()`, no session, no user id from a server.
- User-owned state goes in a **client store** under `app/`, following the
  `useSyncExternalStore` idiom already used by `player/volume-store.ts`.
- `apps/web/lib/env.ts` has **two** variables. Do not add secrets to it.
- Anything a person owns must survive only in their browser, and the UI should
  say so — the phrase used throughout is *"only on this device"*.

---

## Ownership

Neither agent edits the other's files without checking they are not mid-write.

### Agent A — playback, recommendations, shell polish

```
packages/providers/**          recommend.ts, registry.ts, types.ts, ytmusic.ts, deezer.ts
apps/ytmusic/**                the Python sidecar, radio.py
apps/web/app/api/radio/        recommendation endpoint
apps/web/app/api/art/          artwork proxy
apps/web/app/artwork.tsx
apps/web/app/player/           player-context, youtube-player, soundcloud-player,
                               player-bar, add-to-queue, history-store,
                               use-artwork-accent, wavy-progress, volume*
apps/web/app/shell/            app-shell, scroll-thumb
apps/web/app/globals.css
docs/RECOMMENDATIONS.md, docs/BUGS.md
```

### Agent B — library, profile, local data, lyrics

```
apps/web/app/playlists/        local playlist store + all playlist UI
apps/web/app/profile/          local profile, avatar, images, dominant-color
apps/web/app/library/          library route
apps/web/app/playlist/[id]/    playlist detail route
apps/web/app/artist/           artist pages
apps/web/app/api/lyrics/       LRCLIB proxy
apps/web/app/api/artist/       artist lookup
apps/web/app/explore/          Explore route
apps/web/app/collection/[kind]/[id]/    collection route
apps/web/app/rankings/         rankings route
apps/web/app/discover-view.tsx, collection-view.tsx, rankings-view.tsx
apps/web/app/chart-graph.tsx, bar-chart.tsx, stacked-columns.tsx
apps/web/app/collage.tsx, movement.tsx
apps/web/app/chart-memory.ts, explore-lists.ts
apps/web/app/top-bar.tsx, search-store.ts, search-suggestions.tsx
apps/web/lib/deezer.ts, discover.ts, collection.ts, rankings.ts
apps/web/lib/rank-bands.ts, discography.ts
apps/web/app/player/lyrics-panel.tsx
apps/web/app/player/related-panel.tsx
apps/web/app/player/panel-tabs.tsx
apps/web/lib/env.ts, lib/providers.ts
README.md, docs/ROADMAP.md, this file
```

### Shared — announce before a large edit

```
apps/web/app/icons.tsx         append new icons at the end; never reorder
apps/web/app/shell/sidebar.tsx both agents have reason to touch it
apps/web/app/search-results.tsx
apps/web/app/song-card.tsx
apps/web/app/player/now-playing.tsx
apps/web/app/types.ts
```

**Protocol for a shared file:** re-read it immediately before editing, keep the
edit as small as it can be, and run `pnpm --filter @timbre/web typecheck` after.
A build that fails on a file you did not touch usually means the other agent is
mid-write — wait and re-run rather than "fixing" it. This has now happened four
times (`artist-view`, `library-view`, `song-card`, `/profile` prerender) and
each time the file was complete a few seconds later.

### Crossings, so they are not a surprise

**The blend is adopted into the queue early** (`player/player-context.tsx`,
Agent A's file) — a behavioural change, not a cosmetic one, so worth reading
before building on that file.

`/api/radio` results used to sit in `radio` until the queue ran dry. Playing a
search result queues one song by design, so a fresh tab showed a queue of one
and no "up next", then twenty-six entries at once the moment the track changed.
The fetch handler now merges the blend straight into the queue **when the
current track is the last one**, which is the same rule the end-of-queue paths
already applied, just triggered on arrival instead of on exhaustion.

The guard is load-bearing: mid-queue the blend stays parked. The seed moves with
playback, so an unconditional merge would append twenty-five more songs on every
track change. Two refs (`queueRef`, `indexRef`) let the handler read the current
position without the effect depending on it — depending on `queue` would refetch
the blend on every append, which is what the merge exists to avoid.

**`AddToPlaylist` added to the desktop player bar** (`shell/player-bar.tsx`,
Agent A's file) — one import and one element in the left zone, beside the title
and artist. Nothing else in that file touched by this change.

It sits with the track rather than in the transport because everything in the
centre and right of that bar acts on *playback* and this acts on the *song*.
The mobile bar is unchanged: its expanded transport already carries the same
component, and the mini bar has no room for another control.

**`decoding="async"` added to `artwork.tsx`** (Agent A's file) — one attribute on
the `<img>`, nothing else touched. Explore renders 52 covers, mostly 250px
squares in much smaller boxes; decoding those synchronously puts the whole batch
on the thread that also handles scrolling, so the page appears and then stalls.

**`--banner-fade` added to `globals.css`** (Agent A's file) — one declaration
appended inside each of the existing `:root[data-theme="dark"]` and
`:root[data-theme="light"]` blocks. Nothing reordered, no other rule touched.
Pastel inherits the light value through its own more specific selector.

It is how far up the profile banner dissolves into the page, and the two grounds
genuinely need different numbers: a long fade over near-black reads as light
falling off, while the same distance over a pale surface drags a band of
near-white across the middle of the photograph. `profile/profile-view.tsx` reads
it with a `45%` fallback.

It briefly lived in `theme/palette.ts` and came out with a revert of that file,
which left the variable undefined and the fallback silently applying the dark
number to both grounds. It belongs here anyway: it is a distance, not a colour,
and nothing about it moves with the hue or the artwork.

**The theme is applied from the shell, not the player bar.** Agent B moved the
`useArtworkAccent(current?.artworkUrl)` call out of `shell/player-bar.tsx` and
into `shell/app-shell.tsx` — both Agent A's files, one line removed and one
added, plus a comment in each. Nothing else in either was touched, and the hook
itself (`player/use-artwork-accent.ts`) is unchanged.

It had to move. `apply()` in that hook is the only thing that writes the palette
and `data-theme` onto the document after the boot script, and `PlayerBar` only
mounts once `current` is set — so before the first play of a session no theme
was applied at all. Selecting a theme repainted the picker and nothing else,
because the picker reads React state while the document was still wearing the
ground the boot script gave it. The shell always mounts, so the two can no
longer disagree. With no track the hook is passed `undefined` and applies the
ramp with no swatch, which is the path it already had for unreadable artwork.

**The search field moved into the shell.** Agent B added `app/top-bar.tsx` and
mounted it in `shell/app-shell.tsx` (Agent A's file) — one import and a wrapper
around `{children}`, nothing else in that file touched. It has to live above the
router: typing on Home navigates to `/search` on the first keystroke, and an
input owned by the results page would be *created by* the navigation it needs to
survive, losing the caret and the keystrokes typed during the transition.

Knock-on effects, all small:

- `search-results.tsx` (shared) no longer draws a field, owns no query state and
  has lost the `showShelves` prop. It reads `search-store.ts` and renders
  results. `HomeShelves` is unchanged and still exported for `home-view.tsx`.
- `shell/sidebar.tsx` (shared): the `Search` nav entry became `Explore` →
  `/explore`. A tab leading to a box that is already on screen is not
  navigation. `SearchIcon` is no longer imported there.
- `icons.tsx` (shared): `CompassIcon` **appended** at the end, nothing reordered.
- `home-view.tsx`: `<ProfileButton>` removed — the top bar carries it now, so it
  is on every page rather than only Home.
- `lib/discography.ts`'s private Deezer fetch helper moved to `lib/deezer.ts`,
  now shared with `lib/discover.ts`. Behaviour identical.

**`player/youtube-player.tsx` is untouched.** Agent B edited it briefly to try
to suppress YouTube's paused-state overlay, then reverted the file completely —
`git checkout` back to Agent A's committed version, no residue. Nothing in it
needs reviewing.

**Agent B fixed `player/volume.tsx`** (Agent A's file), one line. `applyFrom`
divided the pointer offset by the track's full width, but the addressable
positions run 0..width-1 — so dragging fully right produced **98** on the narrow
bar and 99 on the wide one, rendering a visually-full slider whose audio sat
under maximum. Dividing by `width - 1` maps the last pixel to 100. Keyboard
`End`, the wheel and the default were already correct; only dragging was short.

**Agent B turned YouTube's captions off** in `player/youtube-player.tsx` (Agent
A's file), at the reader's request. Three measures, and the third is the one
that actually works on auto-captioned videos:

- `cc_load_policy: 0` — a request, ignored when the viewer's YouTube account
  forces captions on.
- `setOption("captions", "track", {})` — clears the selected track, which is
  what silences an auto-generated one.
- **`onApiChange`** — captions are a *module*, loaded after the video, so
  unloading on ready or straight after `loadVideoById` runs before the module
  exists and does nothing. `onApiChange` is the documented signal that a module
  loaded, and it is the only hook that fires at the right moment every time.

Nothing else in that file changed; the paused-overlay non-goal below still
stands and was not reopened.

**Agent B fixed the artwork accent** in `player/use-artwork-accent.ts` (Agent
A's file). Two defects in `dominantHue`, both producing visibly wrong colours:

- **Hue was averaged as a plain number.** It is an angle. Red sits at both 0.98
  and 0.02, and their mean is 0.5 — cyan, the exact opposite of the sleeve.
  Verified: the old arithmetic returned 180° for a red cover, the new circular
  mean returns 0°. Hues away from the wrap are unaffected (blue: 216° both ways).
- **A hue on a bucket boundary lost to a lesser one in the middle of a bucket.**
  Scoring now runs over a sliding three-bucket window, wrapping the wheel, so the
  question asked is which *region* of the wheel the cover lives in.

Also softened the saturation exponent from 2 to 1.5, so one neon detail no
longer outvotes the field the cover is made of. `theme/palette.ts` is untouched —
it already clamps saturation and floors the accent, so nothing was double-fixed.

**Agent B softened the light themes** in `theme/palette.ts` and made the scrub's
unplayed rule ground-aware. The visible "line" across the window on a light
theme was the player bar's 2px top border, drawn in `--ink` — which sat at 44%
lightness against a 94% panel, a 50-point contrast gap spent on a rule nobody
asked to look at. `--ink` is 62% on both light ramps now; `palette.test.ts` still
holds it between "vanishes into the plane" and "the dark ramp's harsh outline".

**Correction to the above:** softening `--ink` was the wrong lever and has been
reverted to 44%. The line in question was the **player bar's own top border**,
drawn in `--ink` at 2px full width — and reaching it through the token drained
the weight out of every panel, tile and button at once. `shell/player-bar.tsx`
(Agent A's file) now draws **no top border** on the desktop bar: the scrub
straddles that edge and its own comment already claimed to be the divider, so the
bar was carrying two full-width lines two pixels apart. On dark they merged; on
light they read as a doubled rule. One line, not two.

`player/wavy-progress.tsx` (Agent A's file) gained one change: the remaining
track's `opacity="0.28"` became `var(--wave-rest, 0.28)`, because one number
cannot serve both grounds — the same accent at 0.28 is a faint track on dark and
a drawn line on pale. The palette sets 0.28 dark, 0.22 light, and the fallback is
the value it always had. The light value carries the divider's job now that the
border is gone.

**Agent B reshaped `player/mobile-transport.tsx`** (Agent A's area) toward the
phone layout the reader asked for: a top bar carrying collapse on the left and a
lyrics toggle on the right, the title centred under the video, and shuffle /
repeat / save gathered into one strip. Pressing the toggle reveals Agent B's
`LyricsPanel` **below** the video in a `min-h-0 flex-1` scroller.

Lyrics cannot *replace* the video on this screen: YouTube's terms require the
player to stay visible while its audio plays, so the lyrics-only view other apps
offer is not available here. Under the video is both compliant and what was
asked for.

**Agent B halved search latency** in `apps/ytmusic/app/routes/search.py` and
`client.py` (Agent A's files). The two upstream searches now run at the same time
instead of one after the other.

Measured warm against YouTube, each `ytmusicapi` search is about **1.4s**, and
`e6f273c` — correctly — made the video search unconditional. Sequential, that
made the endpoint cost the *sum*: 2.8s warm, and 3.0–4.6s as observed live. The
two share no data and neither depends on the other's result, so the endpoint now
costs the slower of the two. Measured after: **2.0–2.2s**, and repeat queries
come off `/api/search`'s existing cache in ~0.1s.

Two details worth keeping:

- **A client per concurrent caller.** A `YTMusic` holds one `requests.Session`,
  and concurrent requests through one are *usually* fine rather than guaranteed —
  the cookie jar is shared mutable state. The failure that would produce is
  intermittent wrong results, not an error, which is the worst kind to hunt
  later. `get_client(slot)` keeps one per slot; the cost is one extra config
  fetch, once. Sequential callers still get the default.
- **One extra thread, and no cancellation.** The songs search runs on the
  request's own threadpool thread, which would otherwise sit idle. A failed songs
  search waits for the video search before its 502 propagates; that is deliberate,
  because cancelling a future that has already started does nothing and racing
  `cancel()` against one that has *not* started is how `result()` raises
  `CancelledError` on the success path instead.

Verified: `H5v3kku4y6Q` (the OMV) still ranks first for "harry styles as it was",
which is what `RUNNING.md` specifies, both filters still contribute to the merged
list, and the 49 sidecar tests pass.

**Agent B ran a bug pass over the player and the API routes** — `player-context.tsx`,
`youtube-player.tsx`, `api/art/route.ts` (all Agent A's) and the shared
`search-results.tsx`. Recorded in `docs/BUGS.md` as **B-6** (now `FIXED`), **B-8**
and **B-9**; that file's status column and timeline are updated. Three more, too
small for the bug log:

- **`handleError` never cancelled the previous resolution.** It assigned a new
  `AbortController` over `resolving.current` without aborting the old one, so a
  fall-through during `load`'s own search left that request running and its
  controller unreachable — and its response then overwrote `candidates` for a
  song that was no longer playing.
- **`/search` abandoned its request instead of cancelling it.** The effect cleanup
  cleared the debounce timer only, so leaving the page mid-flight ran a search to
  completion against a metered upstream and then set state nobody was looking at.
- **`/api/art`'s size cap was bypassed by a missing `content-length`.**
  `Number(header ?? 0)` measured a chunked response as zero bytes and streamed it
  through unbounded. The header is still trusted when present; when absent the
  body is metered as it passes and cut off if it runs over.

**Considered and deliberately not done: B-5.** The prescribed remedy is to fetch
the candidate list during `load`'s `resolving` state — but `load` returns early
for the common case (a song that already has a YouTube copy), so there is no
resolving state to piggyback on and doing it would mean an *extra* `/api/search`
for every single play. That is one metered upstream search per track, to save
latency on the ~7% that fall through. B-5 is filed as "low — latency only"; the
trade does not pay at that severity.

---

## Explore was carrying 1.9MB of artwork

*2026-08-17.* Two rules already existed in this codebase and **only `artwork.tsx`
was applying them**. Every other place that draws a cover — the collage, the
Explore hero, the collection and rankings rows — used a raw `<img>` pointing
straight at the CDN, at whatever size the source happened to return.

Measured on `/explore`: **52 covers, every one at 500×500, none proxied.** At
~37KB each that is 1.9MB of pictures for one page load, which is the answer to
"why is it so heavy".

- **They bypassed `/api/art`.** That endpoint exists because content blockers
  filter by hostname, and the urls are perfectly valid — they answer 200 from a
  server, the request just never leaves the browser. Explore had quietly reopened
  the bug the proxy was built to close. All 52 go through it now.
- **They asked for 500×500 to draw 90px.** Deezer states the dimensions in the
  path, so a smaller copy costs one string. A collage tile is 30% of a card that
  tops out around 300px; the featured backdrop is drawn at twice its box behind a
  `blur-3xl`, which mathematically discards any detail a larger copy would carry.

Now 200×200 for tiles, 120×120 for the blurred backdrop, 500 for a cover shown
whole: **1874KB → 391KB, a 79% reduction**, verified by fetching each size from
the CDN.

`app/artwork-url.ts` holds both rules — `proxied`, `sized`, and `cover` which
composes them — and `artwork.tsx` now imports the proxy from there instead of
keeping its own copy. Sizing happens *before* proxying, so the proxy's
`immutable` cache entry is keyed to the copy that is actually shown.

**Only ever downward.** Asking for a larger copy than the source offered would
request an upscale — more bytes for a softer picture — so a url already at or
below the target is untouched, as is any url whose shape this does not recognise.
Confirmed live: eight covers on Explore are 250×250 at source and were correctly
left alone when asked for 500.

**Every remaining raw `<img>` is converted too** — `artist-view`,
`collection-view`, `rankings-view`, `playlist-view`, `player/artist-card` and
`search-results`. Nothing in the app now reaches an artwork CDN directly, and
every cover is requested at roughly twice its CSS size rather than at whatever the
source returns: 112px for a list row, 320 for an artist card, 400 for a collection
header, 640 for an artist hero.

Confirmed live: `/explore` serves 52 covers, **0** direct CDN hits and 52 through
the proxy.

### And the wait in front of Explore, which the animation could not help

Bytes were only half of why that page felt heavy. The other half: `fetchDiscover`
has an **unavoidable waterfall** — it asks Deezer for the chart, and only then can
it ask for the featured playlists' own sleeves, because those requests need ids the
first response carries. Two round trips, about 1.2s cold, and all of it happened
*before any HTML existed*. A navigation to Explore did nothing for over a second
and then produced the entire page at once, so the arrival animation had nothing to
soften — the wait was in front of it rather than inside it, which is why it read as
a flash.

`app/explore/loading.tsx` moves that wait behind the shell. Measured: **time to
first byte 1.2s → 0.25s**, with the content streaming in after. It does not make
Explore faster, it makes it *start* — and in production `revalidate = 3600` means
only the first visitor of the hour pays the 1.2s at all. This is for that visitor,
for a cold cache after a deploy, and for development, where every edit invalidates
and so every load is the slow one.

---

## Heavy was mostly the dev build, and Explore was genuinely dynamic

*2026-08-17.* Measured rather than guessed, with a production build written to a
separate `distDir` so the dev server's `.next` was never disturbed —
`TIMBRE_DIST_DIR=.next-prod pnpm build`, which is what that config option exists
for.

**Production client JS: 774KB raw, 239KB gzipped across all nineteen chunks; CSS
63.6KB raw, 12.2KB gzipped.** That is unremarkable for a React 19 app and is not
what "heavy" was. The 4.5MB measured earlier was the *dev* bundle: unminified, with
the HMR runtime and the devtools chunk in it. Any judgement about weight taken from
a dev server is measuring the dev server.

**But the build did surface a real fault, and a large one.** `/explore` was marked
`ƒ Dynamic` in the route table despite declaring `revalidate = 3600` — so every
visitor re-ran the fifteen-odd upstream requests behind the ranking, rather than
the first visitor of the hour paying for everyone.

The cause: every provider fetches with `cache: "no-store"`, and **one `no-store`
fetch anywhere in a render opts the whole route out of static generation.** That
default is right for the other caller — the API routes are dynamic by declaration
and keep their own two-minute cache in `lib/api.ts`, so a second invisible layer
underneath would stack staleness nobody reasoned about — and wrong for a server
component.

So `SearchContext` gained an optional `revalidate`, `cachePolicy` in
`packages/providers/src/cache-policy.ts` turns it into fetch options, and
`lib/rankings.ts` passes `3_600` to match the route's own value. The route table
now reads `○ /explore  Revalidate 1h  Expire 1y`.

One definition rather than two, because the providers have to agree: if Deezer's
responses were cacheable and Apple's were not, the page would still be dynamic and
neither would be prerendered — a failure that is completely silent, since the page
works and is merely rebuilt every time. That is exactly why it went unnoticed.

Also fixed while there: `eslint.config.mjs` ignores `.next-prod/**`, or linting the
repo lints Turbopack's generated chunks and reports hundreds of errors in code
nobody wrote. Note that a production build rewrites `apps/web/tsconfig.json` to add
its types directory — `git checkout -- apps/web/tsconfig.json` afterwards.

---

### Non-goal: hiding YouTube's paused overlay

Recorded here rather than in the player file, so that file stays Agent A's.
When paused or unstarted, the embed paints the channel name across the top and
share / "More videos" / the logo across the bottom. **It cannot be removed:**

- No player parameter disables it. `controls: 0` removes the control bar and
  `pointer-events: none` removes the hover overlay; the paused state is painted
  regardless. `modestbranding` was retired in 2024 and never covered it.
- It renders inside a cross-origin iframe, so it cannot be styled or scripted
  from Timbre's side. That is the same-origin policy, not an API gap.
- Overscanning the iframe to push it out of view was tried and does not hold:
  the chrome reflows with player size and with the video's title length, so a
  crop tuned at one size misses at another while already eating the picture.
- Covering it would work and is exactly what YouTube's Developer Policies
  forbid. Timbre's position depends on respecting that, so it is closed on
  purpose.

Captions (`[Music]`) are a separate subsystem and **have now been suppressed**
via `cc_load_policy` plus `unloadModule("captions")` — see the crossing above.

---

## Current state

**Agent A** has landed cross-source recommendation fusion (`/api/radio`,
`recommend.ts`, four ranked lists, RRF + consensus scoring), the artwork proxy,
playback history, queue ergonomics (shuffle, repeat, add-to-queue, clear) and a
run of shell/visual fixes.

**Agent B** has landed browser-local playlists (create, rename, delete, reorder,
remove, export/import), a local profile with avatar and banner stored in
IndexedDB, artist pages, and a tabbed expanded-player panel — **Up next ·
Lyrics · Related** — with synced lyrics from LRCLIB.

---

## The profile, gone over end to end

*2026-08-17.* Twenty defects in the local-profile subsystem — "the account", in
the sense that Timbre has one: a name, two pictures and the counts beside them.
They are listed together because **most of them were one symptom**: the profile
arrives in pieces, and every piece that arrives late is a frame of the app
looking wrong.

### Why the page flickered on every load

Nothing about a Timbre profile can be known by the server, and until now nothing
about it could be known before React hydrated either. So a reload went:

1. The rail's profile row rendered **empty** — it was gated on `useHydrated`.
   Its comment claimed the row "keeps its height"; it did not. With no children
   it collapsed to its own padding, so **the entire sidebar dropped 32px and
   snapped back** on every single load. This is the jump that reads as the app
   breaking and then fixing itself.
2. The header's colour wash is sampled from the profile picture, which lives in
   IndexedDB — so hydrate → read storage → decode an image → count its pixels →
   *then* colour the header. Several hundred milliseconds of a flat dark band.
3. Worse, it did it **twice**: the avatar arrives as a `localStorage` thumbnail
   and is then replaced by the full-resolution copy of the same picture, and
   `useDominantColor` returned `null` while re-sampling — so the wash painted,
   vanished and painted again.
4. And for some pictures it never arrived at all. The hook returned `Hsl | null`,
   which made "still decoding" and "decoded, no dominant hue" the same value. A
   greyscale picture, or one that failed to load, left the header waiting for a
   colour that was never coming.
5. The counts rendered a confident `0 playlists · 0 songs` first. The comment
   above them explains at length why that is wrong — "zero is a real and
   meaningful state here" — and the `settled` gate it describes was missing from
   the code. Adding it back was **half a fix**: a blank where two figures belong
   reads as a profile with nothing in it, which is a different wrong answer.
   The figures are recorded and replayed like everything else here — per text
   node, so the digits are already bold before React runs — and a reload shows
   the last ones that were true. Only a browser that has never had counts shows
   nothing, which is the one case where nothing is the truth.

**The fix is one idea, applied consistently: whatever the first paint needs, the
client records and the boot script replays.** That is the arrangement
`timbre:palette` already used for the theme. It now covers the name, the
monogram, the cached picture, the header wash and the counts. A single
`.replay:empty::after` rule in `globals.css` makes the handover clean — React
leaves its slots empty until it can be right, CSS fills them meanwhile, and the
rule stops applying by itself the instant real text lands, so the two can never
both be showing. Each slot names its own recorded value through `--replay`,
which is why one rule serves all of them.

**The bar is "the reload is invisible", not "the reload is quick", and that
distinction cost two round trips.** The counts line was first recorded as one
finished sentence, which got the words right and the *styling* wrong: a flat run
of dim text, replaced a moment later by the same words with bold white digits.
Nothing arrived late and it still visibly changed — which is the same defect,
just harder to see and harder to explain. So the unit is the individual text
node, not the line: every figure sits in the element that styles it.

### And the arrival is one gesture: the content fades, the shell does not

Four attempts at holding the whole document until it was whole, and the reader
landed somewhere simpler than any of them: **only the routed content animates, and
only on a navigation.** `.page-in` in `globals.css`, keyed on the pathname in
`app-shell.tsx`.

**A first load does not animate at all, and that is not a compromise.** A CSS entry
animation only works on an element created while the page is already live. On a
fresh document it begins when styles resolve, not when the browser first paints —
so if the first paint lands after those 220ms have elapsed, which is ordinary on a
cold load, the fade is already over and the content simply appears at full opacity.
That reads as a flash, and it is the animation *failing to be seen* rather than
being wrong. There is nothing to tune: whether the paint beats the animation is a
race with parsing, fonts and the bundle, decided differently on every load.

So `AppShell` adds the class only once this document has navigated. `movedOnce` is
module scope rather than a ref or state because both alternatives are lint errors
here — reading a ref during render, and `setState` inside an effect — and it is
neither React state nor a subscription, just one fact about the life of the page.
Safe despite the module being shared across server requests, since it is assigned
only from an effect and a server render always has `pathname === openedAt`.

The whole `data-ready` mechanism is gone — the boot-script hold, `app/reveal.tsx`,
the body opacity rule, the sweep and breathe indicators and their keyframes. What
it bought was never worth its cost:

- **It hid pages that were already complete.** A server-rendered route arrives in
  the first byte; holding it until hydration delayed content for nothing.
- **Its duration was unstable**, because it ended whenever hydration ended. Fixing
  that with a floor made every page slower on purpose to make the jitter go away.
- **It fought streaming.** Releasing on `DOMContentLoaded` would have waited for
  the entire stream, which is exactly what a Suspense boundary exists to avoid.

`.page-in` has none of those problems. It is in the server markup, so it plays as
soon as the content is parsed — nothing hidden, nothing timed, no JavaScript
involved — and it is identical on a fresh load and on a client-side navigation,
which are the same act to the reader. Animating only the content is also the
honest reading: the sidebar and the player bar do not go anywhere when the page
changes.

**What this gives up, deliberately.** Without the hold, the pieces that genuinely
cannot be known before hydration arrive after the fade — the playlist grid on the
profile and the library, and Home's cached charts. Everything that *can* be
recorded still is, so the name, the picture, the header wash and the counts are
all correct in the first frame; it is only those two lists that land late.
Recording them the same way is possible and was not done.

**Home's skeletons are worth a note**, because they looked like a network wait and
were not: they are the *pre-hydration* frame, since `charts-cache.ts` returns null
from `getServerSnapshot`. The cached charts land a beat later, so a warm reload
shows real songs and the placeholders appear only on a genuine first visit, which
is the one time they are the truth.

**Recorded as finished strings, never as inputs.** Re-deriving the gradient or
the hash in an inline script would be a second definition of the profile's
colour, wrong the first time either changed. Replaying a recorded result cannot
drift; at worst it is one load out of date, and the render immediately corrects
it.

**Not by reading the cookie in the root layout,** which was the obvious
alternative and is the wrong trade: `/profile` reads `timbre-name` and is
dynamic for it, but `cookies()` in the layout would make **every** route
dynamic — `/explore`, `/artist/[name]` and `/collection` are all `revalidate =
3600` and would have lost it. A custom property costs nothing on the server.

### The boundary that fixed the pictures

`avatar.tsx` used to fall back to `--avatar-thumb` *always*. Nothing clears a
custom property the document is already wearing, so **removing your profile
picture left the removed picture on screen until a reload** — with the monogram
underneath it hidden by `--avatar-letter: 0`. The variables are now consulted
only until hydration; from the first render that can read storage, React decides
and they are ignored. `clearLocalImage` clears them too, so nothing stale
survives on the document either way.

### The rest, briefly

| | |
|---|---|
| Clearing your display name **did not clear it** | `profile.name \|\| serverName \|\| "Profile"` reached past the client's `null` to the cookie the server rendered from, and the old name came back until a reload. Post-hydration, storage is the only authority. |
| A rejected picture reported nothing | The error message is positioned below the avatar, and the avatar's box is `overflow-hidden rounded-full` to make the photograph round — so the rejection was computed, reported, and clipped away to nothing. Two boxes now; only the inner one clips. |
| The banner's rejection landed in the wrong corner | `left-0` against the whole header put a 224px box in the bottom-left. It hangs from the button now. |
| A failed save left a ghost | The thumbnail is written before the IndexedDB put — it has to be — so a quota failure left a small copy of a picture that was never stored, shown at first paint and taken away again. Rolled back with the write now. |
| Six IndexedDB connections per load, none closed | Every `run()` opened its own. One cached connection, dropped if the browser closes it. Open handles are also what would have blocked a `DB_VERSION` bump. |
| The orphan migration ran in front of every read | Two `getAllKeys` scans and a `localStorage` sweep before the picture could be fetched, on every load, for a browser with nothing to migrate — which is every browser after the first. Now the pictures are read first and the migration only runs if one is missing. |
| Blocked IndexedDB threw away working thumbnails | The `catch` reset the snapshot to all-null, discarding thumbnails that came from a *different* store with different failure modes. |
| No cross-tab sync | The theme, the playlists and the history all follow a `storage` event; the profile and its pictures did not, so a rename or a new picture in one tab left every other tab stale indefinitely. Pictures use their thumbnail's event as the signal, since IndexedDB fires none. |
| A malformed name cookie **500'd the page** | `decodeURIComponent` throws on a bare `%`, and the page that would have let you clear it is the page that was failing. |
| Control characters reached a cookie and a CSS string | Stripped once, in `setDisplayName`, rather than escaped at each of the three places the name lands. |
| `/profile` was stored in the service-worker cache | It is the only response in the app whose HTML differs between readers. Excluded (`PERSONAL` in `sw.js`, version bumped to `v3` so what v2 kept is dropped), and `next.config.ts` now states `private, no-store` and `Vary: Cookie` explicitly rather than resting on a framework default nothing asserted. |
| Export could fail silently | A detached anchor is ignored outright by Firefox, and revoking the blob URL on the same tick races the browser's read of it — on the one feature that exists because a browser is the only copy of these playlists. |

Incidentally: the "not yet" avatar was never grey. `background-image: var(--surface-2)`
is invalid — a colour is not an image — so the declaration was dropped and the
circle was transparent. It has a background colour now.

### The picture itself was soft, in two separate places

Once the flicker was gone, what was left in the first frame was a *blurry*
avatar — and it turned out not to be one bug.

**The synchronous copy was 96px on the long edge, for both pictures.** That is
the right size for the two places the avatar is small — 32px in the rail, 36px in
the phone's corner — and badly wrong for the one place it is large: the profile
header draws it at 192px, which is 384 device pixels at 2× and 576 on a phone at
3×. Upscaling a 96px source four to six times is not "the right picture for an
instant", it is a visibly mushy one, and since this copy is *what you see first*,
a soft first paint was the whole first paint. Now 384 for the avatar — a desktop
header at 2× and a phone's 128px avatar at 3×, exactly — and 768 for the banner,
which is a compromise rather than a fit because it spans the page.

`THUMB_VERSION` exists so that raising those numbers reaches people who already
have a picture. The backfill only wrote a thumbnail when one was *missing*, and a
96px thumbnail is not missing, so without a version check every existing profile
would have kept the soft first paint for ever. `writeThumb` also checks what
`toDataURL` actually returned: it does not fail on a type it cannot encode, it
silently hands back a PNG, and at 384 and 768 a PNG of a photograph is hundreds
of kilobytes out of the 5MB pool the playlists share.

**And `redraw` was upscaling.** It forced every picture to exactly 512×512
whatever it started as, so a 200px avatar — a phone crop, anything off social
media — was stretched two and a half times and *then* encoded at quality 0.82.
That bakes the upscale in permanently: the interpolated pixels are what get
compressed, the file is bigger **and** softer than the one it came from, and
drawing it smaller later recovers nothing. The target is a maximum now, and the
crop is expressed as a source rectangle — the same "cover" result stated
directly, verified against nine source shapes for no upscale, nothing over
target, and aspect preserved so the circle still fills.

### Still open

**Export does not include the profile.** `README.md` implies it does, and it
does not: the file is playlists only, so a cleared browser loses the name and
both pictures with no way to have kept them. The README no longer claims
otherwise. Doing it properly needs a decision this did not want to make on
somebody's behalf — whether importing a profile onto a browser that already has
one overwrites it — so it is written down rather than guessed at.

**The banner has no first-paint replay.** A banner reader still gets one frame of
plain ground. The wash record deliberately clears itself when a banner exists,
since replaying a colour under a photograph would paint it and take it straight
off again. Recording the banner's own layered background is possible and was not
done; the wash is the case that was actually visible.

---

### Deliberate absences, so they are not "fixed" by mistake

- **No Comments tab.** They belong to the upload rather than the recording, need
  a keyed API, and would differ per fallback copy. Stated in `panel-tabs.tsx`.
- **No cross-device sync.** It would require the server-side data that was just
  removed. Export/import is the answer.
- **No public profiles.** Nothing is shared between people; there is no "other
  person" to show one to.


