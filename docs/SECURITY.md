# Security review

A vulnerability pass over Timbre, mapped to the **OWASP Top 10:2025**.

*Reviewed 2026-08-18, against `1b90b08`. **Second pass 2026-08-21**, against
`daf4756` — the first one run against a live deployment rather than a working
tree, which is how S-7 was caught. **Third pass 2026-09-11**, against `8abfc8e`
(local `main`, seven commits ahead of `origin/main`) and the live deployment —
S-9 onward. **Fourth pass 2026-09-13**, against `dcec2f4` — S-20, and the CSP flip
E-14 had been waiting on. Its statuses were updated on 2026-09-11 against `6f3b6ae`, and its
file:line citations re-pointed there, because the files `8abfc8e` was read at have
since been trimmed: comments stripped, code simplified. The SHAs of the first two
passes predate the history rewrites and no longer resolve.*

This is a different question from [EXPOSURE.md](EXPOSURE.md). That file asks what
a public deployment *spends* and what it *risks by policy*. This one asks whether
the code can be made to do something it should not. Where the two touch, this
file cross-references rather than repeats.

**Scope:** `apps/web`, `apps/ytmusic`, `packages/core`, `packages/providers`, the
GitHub Actions workflows, and the dependency graph of both runtimes.

**Method:** static review of every trust boundary, plus dependency audits, plus a
proof-of-concept test for the one finding that warranted one. Every finding below
was verified — none is a pattern-match on a grep.

Severity: `HIGH` · `MEDIUM` · `LOW`

---

## The short version

Timbre has an unusually small attack surface, and it earns most of that honestly.
There is **no authentication to break, no database to inject, no user record to
steal, and no server-side state to corrupt** — so five of the ten OWASP
categories barely apply. The XSS surface, which is the one that should worry an
app that embeds third-party players, is genuinely clean: there is exactly one
`dangerouslySetInnerHTML` and it interpolates nothing, and there is not a single
`postMessage` listener in the codebase. *(Fourth pass: that last clause is now stale —
there are two same-origin `message` listeners. Neither is a cross-origin sink. See below.)*

One finding is serious, is proven, and is not on the server.

**The second pass added two, and neither is a disclosure.** Both are the same
shape — a failure path nobody had walked. S-7 is an unauthenticated 500 on the
sidecar from a single non-ASCII header byte; S-8 is that no upstream request had
a deadline, so one silent host could hold a search open until the platform killed
it. Both were fixed the same day they were found. Notably, S-8's lesson was
already written down *in this repository*, in the one file that had hit it — and
had not been generalised to the path every adapter uses.

**The third pass found no disclosure and no script execution either.** Three
MEDIUMs, all availability or integrity of the reader's own browser: the outbound
limiter queued without a deadline, so one client inside its own rate limit could
stall every search on an instance (S-9, measured); three server-rendered pages
called no `guard()` and turned out to be uncached on every hit (S-10, confirmed
live); and the S-1 class was back one level down — a shared playlist file could
still crash pages for good, through a field *inside* a song rather than the song
itself (S-11). The rest was LOW. Two "verified correct" rows below no longer held
and were marked. And E-14's prescribed ten minutes — flipping the CSP to enforcing —
was three weeks overdue: live headers on 2026-09-11 still said `Report-Only`.

**Most of it was fixed the same day.** S-11, S-12, S-14, S-15, S-16 and S-17 are
closed, and both stale rows hold again. S-9, S-10, S-13, S-18 and S-19 are partly
fixed, and each says what is left: the largest is that the artist page still runs
the full search fan-out on the server for every new name (S-10). E-14 is still
open. The first sweep for it found that enforcing would have broken the Deezer and
Apple Music players, and that is fixed; the policy stays `Report-Only` until a sweep
can also exercise YouTube, SoundCloud and Mixcloud playback.

---

# S-1 · A crafted playlist file permanently bricks the app `FIXED`

**OWASP:** A10:2025 Mishandling of Exceptional Conditions, with A06:2025
Insecure Design underneath it — validation is missing at a trust boundary.

**Impact:** persistent client-side denial of service. Every page, not one page.
Recovery destroys all of the victim's data.

**Fixed in `f363aa0`.** The account below is kept in the past tense it was written
in — it is the record of what was wrong, and the regression test in
`app/playlists/store.test.ts` is built from the payload in it.

## What is wrong

`importPlaylists` (`apps/web/app/playlists/store.ts:234`) is the only place
where a file from outside Timbre becomes application state. It validates the
wrapper and the playlist objects, and **never validates the songs**:

```ts
const incoming = file.playlists.filter(
  (playlist): playlist is LocalPlaylist =>
    typeof playlist?.name === "string" && Array.isArray(playlist?.songs),
);
```

`Array.isArray` is the whole check. The array's *contents* are accepted as-is
and cast to `Song[]`, a lie the type system cannot catch because the input is
`unknown`.

Downstream, `summarise` (`store.ts:43`) assumes every element is an object:

```ts
covers: playlist.songs.map((song) => song.artworkUrl)…
```

A `null` in that array is a `TypeError`.

## Why it is persistent rather than transient

The ordering in `persist()` (`store.ts:117-126`) is what turns a crash into
permanent damage:

```ts
window.localStorage.setItem(KEY, JSON.stringify(all));   // ← poison written
…
store.publish(state(null));                              // ← then it throws
```

**Storage is written before the state that throws is computed.** So the failed
import is not rolled back — it is saved. On the next load, `readStorage`
(`store.ts:67`) has its own `try/catch` and returns the entry happily, because it
shape-checks playlists with the same insufficient check and repairs only
timestamps. `state()` then calls `summarise` **outside any `try/catch`**, and
throws again.

## Why it takes down every page

`store.read` is called from `getSnapshot`, which `useSyncExternalStore` calls
**during render**. So the `TypeError` is a render-phase throw.

`Sidebar` calls `usePlaylists()` and `loadPlaylists()`
(`apps/web/app/shell/sidebar.tsx:37,42`), and `Sidebar` is mounted in the app
shell (`apps/web/app/shell/app-shell.tsx:78`) — which wraps **every route**.

And there is **no error boundary in the application at all**: no `error.tsx`, no
`global-error.tsx` anywhere under `apps/web/app`. So the throw reaches Next's
default handler and the whole app is replaced by an error page, on every route,
on every load.

The only recovery available to a non-technical user is clearing site data —
which also deletes every legitimate playlist, the profile, and the listening
history. **The remedy destroys exactly what the attack targets.**

## Proof

Run against the real module, not a reconstruction:

```ts
const hostile = {
  format: "timbre.playlists",
  version: 1,
  playlists: [{ name: "pwn", songs: [null] }],
};

assert.throws(() => mod.importPlaylists(hostile), TypeError);   // ✔ passes
assert.match(store["timbre:playlists"] ?? "", /pwn/);           // ✔ written anyway
assert.throws(() => mod.loadPlaylists(), TypeError);            // ✔ and again, forever
```

All three assertions pass. `[null]` is the shortest payload; `[1]`, `["x"]` and
`[[]]` do not throw, so the trigger is specifically `null` or `undefined` in the
songs array — which is exactly what a truncated or hand-edited export produces
by accident.

## Delivery

The import is a deliberate user action behind a file picker
(`apps/web/app/playlists/library-view.tsx:56`), so this needs the victim to
accept a file. That is a real barrier and it is not much of one: exported
playlists are *designed* to be shared between people and devices, which is the
entire premise of the feature. A "here's my library" file is a normal thing to
send someone.

**It is also reachable without an attacker.** A truncated download, a sync
conflict, or any bug that writes a malformed entry produces the same permanent
crash. Treating this purely as an attack understates it.

## Fix

Four changes, in order of importance:

1. **Validate song elements** in `importPlaylists` — at minimum
   `typeof song === "object" && song !== null`. Drop what fails rather than
   rejecting the file, matching how `readStorage` already repairs timestamps.
2. **Validate them in `readStorage` too.** The import is one way in; storage is
   the other, and it is the one every page reads. Fixing only the import leaves
   already-poisoned browsers broken.
3. **Persist after computing state, not before**, so a throw cannot leave
   storage holding something that cannot be read back.
4. **Add `app/global-error.tsx`.** Independent of this bug: with no boundary,
   *any* render throw anywhere costs the whole application. This is the cheapest
   resilience in the entire codebase.

A regression test belongs with (1) — the payload above is the test.

---

# S-2 · No error boundary anywhere `FIXED`

**OWASP:** A10:2025 Mishandling of Exceptional Conditions.

Called out separately because it is not specific to S-1 and outlives it.

**`read`.** There is no `error.tsx` or `global-error.tsx` under `apps/web/app`.
Timbre reads five separate `localStorage` stores during render via
`useSyncExternalStore` — playlists, theme, history, lyrics preferences, artwork
accent — and each `read` is documented as owning its own `try/catch`. Four of
them do. The fifth's is incomplete, which is S-1.

That is a design that depends on every store getting its error handling exactly
right, forever, with nothing behind it if one does not.

**Fixed in `f363aa0`.** `app/global-error.tsx` — and it had to be that file rather
than `error.tsx`, since a throw in the root layout is above a segment boundary. It
imports nothing from the app, because every module in it is a suspect. It offers a
**raw, unparsed dump of storage before the reset**, so the recovery no longer
destroys what it is recovering.

---

# S-3 · GitHub Actions are pinned to mutable tags, with write access `FIXED`

**OWASP:** A03:2025 Software Supply Chain Failures.

**`read`.** Every workflow step references a tag, not a commit:

```
actions/checkout@v4      pnpm/action-setup@v4
actions/setup-node@v4    actions/setup-python@v5
```

Tags are mutable. Whoever controls the repository behind one of those actions can
repoint `v4` at new code, and it runs on the next build with whatever permissions
the job holds.

**Why it matters more in `release.yml` than in `ci.yml`:** the release job
declares `permissions: contents: write` and runs on pushes to `main`. A
compromised action there can write to the repository and read the token that lets
it. This is the exact shape of the `tj-actions/changed-files` compromise of March
2025, which reached tens of thousands of repositories through a retagged action.

**Fixed in `e561412`**, all nine `uses:` across both workflows. Pinned to full
commit SHAs with the tag in a trailing comment —

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

Dependabot updates SHA pins as readily as tag pins, so this costs nothing
ongoing. Do `release.yml` first; it is the one holding a write token.

---

# S-4 · The Python service has no lockfile `FIXED`

**OWASP:** A03:2025 Software Supply Chain Failures.

**`read`.** `apps/ytmusic/pyproject.toml` declares open-ended ranges:

```toml
"ytmusicapi>=1.12,<2"    # bounded
"fastapi>=0.115"         # unbounded
"uvicorn[standard]>=0.32" # unbounded
"pydantic>=2.9"          # unbounded
```

There is no `uv.lock`, no `requirements.txt`, no `poetry.lock` — verified by
searching the tree. CI runs `pip install -e ".[dev]"`, and Vercel's Python
runtime installs from the same file.

**Two consequences.** Every CI run and every deployment resolves the dependency
graph fresh, so builds are not reproducible and a green run does not tell you
what a later one will install. And there is no upper bound on three of the four
direct dependencies, nor on any transitive one — a malicious or broken release
anywhere in that graph is picked up automatically, with no review step.

The contrast is instructive: the JavaScript side has `pnpm-lock.yaml` and CI runs
`pnpm install --frozen-lockfile`, so the same class of risk is already handled
there. The Python side simply never got the same treatment.

`ytmusicapi` is correctly bounded, and the comment explaining why is right — the
reasoning just was not extended to the rest.

**Fixed in `e561412`.** `apps/ytmusic/uv.lock` pins 55 packages, and Vercel reads
it alongside `pyproject.toml` — verified against their Python runtime docs — so CI
and production install the same versions for the first time. CI runs
`uv sync --locked`, which refuses to re-resolve, and now also runs `pip-audit`
against an export of that lock. Verified on 3.11 in a scratch checkout: 55 tests
pass, no known vulnerabilities.

---

# S-5 · Redirects bypass the art proxy's allowlist `FIXED`

**OWASP:** server-side request forgery.

**Fixed in `1e2e536`** — `redirect: "manual"`, re-validating every hop against the
same allowlist, three hops maximum, tested against a real loopback server rather
than a stubbed `fetch`.

Full detail in [EXPOSURE.md](EXPOSURE.md) as **E-8** — `fetch` defaults to
`redirect: "follow"`, and the host allowlist is applied only to the URL supplied,
never to where a redirect lands. Repeated here because it is the only genuine
SSRF-shaped issue in the codebase and belongs in a security index.

Also in that file and relevant here: **E-7** (`/api/art` has no rate limit at
all), **E-14** (no CSP or other security headers — A02:2025 Security
Misconfiguration), **E-11** (no secret rotation path — A07:2025 Authentication
Failures), and **E-12** (the sidecar logs no authentication failures —
A09:2025 Logging and Alerting Failures).

---

# S-6 · The same missing validation exists on the storage path `FIXED`

**OWASP:** A06:2025 Insecure Design.

`readStorage` (`store.ts:74-96`) checks `id`, `name` and `Array.isArray(songs)`,
then repairs timestamps — careful work, and it stops one element short. It is the
same gap as S-1 reached by a different route, which is why the fix has to be
applied in both places and not just at the import.

**Fixed in `f363aa0`.** `usableSongs()` is applied at *both* entries, so a browser
already holding a poisoned record heals on read rather than needing the fix before
it was hit.

Recorded separately because the class is what matters: fixing only the import
would have left every already-affected browser broken.

---

# S-7 · A non-ASCII secret header crashes the sidecar `FIXED`

**Severity:** `LOW` — A10:2025, Mishandling of Exceptional Conditions.

**Found in the second pass, 2026-08-21. Measured, not read** — reproduced locally
*and* against the live deployment before the fix:

```
X-Timbre-Secret: wrong    → 401 Unauthorized
X-Timbre-Secret: café     → 500 Internal Server Error
```

`hmac.compare_digest` raises `TypeError` when either `str` argument holds a
character outside ASCII, and ASGI decodes header bytes as latin-1 — so **one byte
`>= 0x80` in that header** arrived as a non-ASCII `str` and took the request down
with an unhandled exception.

This is the entry directly above's blind spot. "Timing attacks — correct" was
right about the thing it looked at: the comparison *is* constant-time, and the
accumulate-don't-short-circuit loop above it is a genuinely careful piece of work
that stops a rotation leaking which secret matched. The defect was one layer
under that care, in the argument type, and reading the function for timing is
what made it invisible.

**Nothing was ever let through** — a raise is a refusal. What it cost:

- An **unauthenticated crash path** anyone could hold open, at one billed
  invocation per request on a serverless host.
- A **401-vs-500 split** that fingerprints the service to an unauthenticated
  caller, and makes a log unable to tell a wrong secret from a broken one.

## Fix

Compare **bytes**, not `str`:

```python
candidate = presented.encode("utf-8", "surrogateescape")
found = False
for secret in SHARED_SECRETS:
    found |= hmac.compare_digest(candidate, secret.encode("utf-8"))
```

`surrogateescape` is what makes the encode total — latin-1 decoding can yield
lone surrogates, and a plain `.encode()` would itself raise for exactly the
inputs this must survive. Every timing property is unchanged: `compare_digest`
on bytes is the same primitive.

Covered by `test_a_non_ascii_secret_is_refused_rather_than_raising`, which asserts
the five shapes that used to raise — `café`, a bare `\xe9`, an emoji, a valid
secret with one accented character appended, and a lone surrogate — now return
`False`. Re-verified against the running service: **401, not 500.**

---

# S-8 · No upstream request has a deadline `FIXED`

**Severity:** `MEDIUM` — A06:2025, Insecure Design. Availability, not disclosure.

**Found in the second pass, 2026-08-21. `read`,** and it is a three-file
conclusion rather than a line:

- `providers/request.ts` called `fetch` with `signal: ctx.signal` and **no
  timeout of its own**.
- `/api/search` passes **no signal at all** — deliberately, and correctly: a
  cached call is shared, so one subscriber navigating away must not cancel the
  answer everyone else is waiting on.
- `searchAll` fans out under `Promise.allSettled`, which waits for the slowest.

Each of those is defensible alone. Together they meant **nothing in the search
path could time out**. A source that accepted the connection and then said
nothing held the whole search open until the platform's own limit — 300s on
Vercel — and because `cached()` keys its in-flight promise by query, every
concurrent search for that query waited on the same hang.

**This exact failure was already understood in this codebase.**
`soundcloud-client-id.ts:29` says it outright — *"`fetch` has no timeout of its
own, and a crawl that never settles is never retried"* — and records the
measurement: three calls against a host that accepts and then goes silent made
one request and never made another. It was fixed there, in that file, and never
generalised to the requester every adapter actually goes through.
`lib/deezer.ts`, `/api/lyrics` and `/api/health` had each independently chosen a
6-second `AbortSignal.timeout`. The shared path had nothing.

## Fix

A default 6s deadline in `createRequester`, composed with the caller's signal
rather than replacing it:

```ts
const timeout = AbortSignal.timeout(ms);
return caller ? AbortSignal.any([caller, timeout]) : timeout;
```

Composed, because honouring only the deadline would ignore a caller that did
abort, and honouring only the caller leaves the hang. Per call, because
`AbortSignal.timeout` starts counting when it is constructed — a module-level one
would expire six seconds after boot. `init`/`extra` still override it, which is
the existing contract.

Two things fall out of the same change:

- **A timeout is reported as a timeout.** `${label} did not answer within 6s.`
  rather than `${label} unreachable.` — both `transient`, both retried the same
  way, but a log that cannot tell "the host is gone" from "the host is slow"
  sends you to the wrong place.
- **A 200 that is not JSON is now this source's error.** `await response.json()`
  sat outside the `try`, so an upstream serving an HTML error page with a 200
  threw a bare `SyntaxError` past every caller that catches `ProviderError` —
  including `searchAll`, which would have shown it as an unlabelled failure.

A slow source is now dropped from *that* search and reported as a failure, which
the UI already renders. Four tests cover it, including one that stubs a host
which accepts and never answers — the failure mode an unreachable host does not
reproduce.

---

# Third pass — 2026-09-11

Static review of everything that changed since the second pass (~140 files: Spotify
search and collections, Explore, radio, taste, the service worker, the canary), a
re-check of the earlier "verified correct" claims, local proofs against the real
modules, and plain `GET`s against the live deployment. Nothing was sent anywhere
else: no `pnpm audit`/`pip-audit` (both upload the dependency list), no `POST` to
either deployment; advisories were read by hand. Nothing was fixed in the pass
itself.

**Updated 2026-09-11, against `6f3b6ae`.** The fixes landed the same day, and each
entry now opens with its status: what was fixed, in which commit, and what is still
open. The account under it is the finding as reported, in the past tense where the
code has changed. Every file:line points at the current file, and where the pass
quoted a comment the trim has since removed, the text says so.

---

# S-9 · One client inside its own rate limit can stall every search on an instance `FIXED`

**Severity:** `MEDIUM` — A06:2025 Insecure Design. Availability. **Measured.**

**Fixed for search in `b18028f`.** `acquire` now takes a wait bound and a signal
(`packages/core/src/limiter.ts:97-112`). A caller whose slot lies further off than its
bound is refused at once instead of queued (`:125`), and one that aborts while waiting
hands its slot back (`:105-111`). `createRequester` starts its deadline *before* it
waits and passes the same deadline as the bound (`packages/providers/src/request.ts:38-42`),
so the 6 seconds now cover the queue as well as the fetch. A source with no free slot
in time fails as `rate_limited`. The burst below is now a regression test
(`packages/providers/src/registry.test.ts:84`): the next search returns in under a
second, with Apple reported as rate-limited.

**The Spotify lookups followed in `1e9a114`.** They did not go through
`createRequester`, so `quietly()` in `spotify.ts` and `get()` and `pathfinder()` in
`spotify-web.ts` still called `acquire` with no wait bound. All three now take their
slot through `takeSlot` (`packages/providers/src/request.ts`), the same bounded wait the
requester uses, refused as `rate_limited` past the 6-second deadline — MusicBrainz's
one-request-per-1.1s bucket included.

`RateLimiter.acquire` waited until a token was free, however long that took: no
maximum wait, no queue cap, no signal. And `createRequester` acquired *before* it
built S-8's 6-second deadline, so the deadline covered the fetch and never the queue
in front of it.

Apple's bucket is 5 tokens refilling at 0.3/s (`limiter.ts:47`), 18 a minute.
`searchAll` waits for every provider under `Promise.allSettled` (`registry.ts:47`), so
a search is as slow as its Apple call, and the Apple call was as slow as the queue.
Every distinct query costs one Apple token; `guard()` allows 60 a minute per client
(`apps/web/lib/api.ts:14`).

Proof — the real `searchAll` and `RateLimiter`, `fetch` stubbed to answer instantly, so
every second measured is queue:

```
burst of 12 distinct searches; the next reader's search took 26.7s (fetch stubbed to 0ms)
predicted by Apple's bucket (capacity 5, 0.3/s): 26.7s
```

At `guard()`'s own ceiling — one distinct query a second from one address — the backlog
grew by 42 a minute and each minute added 140s to the wait. After about two minutes a
search from *anyone* on that instance waited past Vercel's 300s limit and ended in a
platform timeout. Nothing reached Apple faster than it should; the limiter did exactly
its job. The defect was that "wait your turn" had no upper bound, and a search waits
for its slowest source. S-10 removed even the per-client ceiling.

Two smaller consequences of the same shape: an aborted caller (radio passes
`request.signal`) kept its place in the queue, because `throwIfAborted` was checked
once, before `acquire`; and ordinary traffic did this too, only slower — a debounced
search box sends a distinct query per pause, and more than ~18 a minute per instance
started the same backlog.

**Fix:** bound the wait. Give `acquire` a `maxWaitMs` (the deadline) and an optional
signal; when the computed wait would exceed it, throw `ProviderError(id,
"rate_limited")` at once instead of sleeping. The search then reports "Apple is
rate-limited" — which the UI already renders — and returns on time. Apple carries no
ISRC and plays only as a link (`packages/providers/src/apple.ts:37,40`), so shedding it
under load costs almost nothing. Regression test: the burst above must leave the next
search under the deadline.

---

# S-10 · Three server-rendered pages call no `guard()`, and are uncached on every hit `PARTLY FIXED`

**Severity:** `MEDIUM` — A06:2025 Insecure Design. Cost and availability. **Confirmed
live.**

**Partly fixed in `b18028f`**: steps 1 and 3 below, the first in a different form.

- The artist, album and collection pages declare `dynamic = "force-static"` beside
  their `revalidate` (`apps/web/app/artist/[name]/page.tsx:14-15`,
  `apps/web/app/album/[id]/page.tsx:8-9`, `apps/web/app/collection/[kind]/[id]/page.tsx:19-20`),
  which is the second of the two ways the reference cited below gives, so a repeat of a
  URL is served from the ISR cache. The album page also gained a `revalidate` of an hour.
- `apps/web/proxy.ts` meters all three through `guard()` (`proxy.ts:5-11`), on a
  separate `pages` budget of 120 a minute per client rather than the API's 60
  (`apps/web/lib/api.ts:14`).
- An artist page on which no source answered throws to a retry notice
  (`artist/[name]/page.tsx:39-43`, `artist/[name]/error.tsx`), so the new cache does
  not keep an empty page for an hour.

`/collection/ytmusic-playlist/[id]`, added after this pass, renders through the same
collection page and is covered by both.

**Step 2 landed in `45649bc`:** the artist page no longer runs `searchAll` on the
server. It renders the artist, discography and biography from Deezer's fetch-cached
lookups, and the browser loads the songs from `/api/search` — metered, and cached for
two minutes — so a fresh `/artist/<anything>` no longer fans out to every source.

**Still open:**

- **A failure can be cached like an answer** on the album and collection pages, and in
  the artist page's header and discography.
  `deezer()` returns `null` for "not found" and "failed" alike
  (`apps/web/lib/deezer.ts:15-28`), and each page turns `null` into `notFound()`
  (`album/[id]/page.tsx:19-20`, `collection/[kind]/[id]/page.tsx:36-37`). The Spotify
  and YouTube Music collections catch to `null` the same way
  (`apps/web/lib/collection.ts:225,261-263`). On a force-static page that result can be
  cached like any other render.

EXPOSURE.md Part 3 audits "the routes anyone can call" and means `app/api/*`. Pages are
routes too:

| Page | Per request | Declares |
|---|---|---|
| `/artist/[name]` | `searchAll(…, 40)` — the full fan-out: a sidecar invocation, an Apple token, Audius, Mixcloud, Deezer — plus Deezer's artist, albums and related | `revalidate = 3600` |
| `/collection/spotify-album\|spotify-playlist/[id]` | Spotify pathfinder (a token bootstrap on a cold instance), then the embed-page fallback | `revalidate = 900` |
| `/collection/genre\|radio\|playlist\|mood/[id]` | several Deezer calls | `revalidate = 900` |
| `/album/[id]` | a Deezer album | — |

None called `guard()`, so none was metered at all. And the `revalidate` exports were
inert — E-6 again, on pages. The `generateStaticParams` reference shipped in
`node_modules/next` says a dynamic segment is cached on first visit only if the page
returns an empty array from `generateStaticParams` or declares `force-static`; none of
these did either. Measured on the live deployment, two consecutive `GET`s of the same
fresh URL and one of each other kind:

```
/artist/zz-sec-probe-…          private, no-cache, no-store   X-Vercel-Cache: MISS   2.41s
/artist/zz-sec-probe-… (again)  private, no-cache, no-store   X-Vercel-Cache: MISS   1.62s
/album/302127                   private, no-cache, no-store   X-Vercel-Cache: MISS
/collection/genre/132           private, no-cache, no-store   X-Vercel-Cache: MISS
/explore                        public, max-age=0, …          X-Vercel-Cache: PRERENDER
```

So `/artist/<anything>` was `/api/search` with the guard and the shared cache taken
off — and it fed S-9's queue directly. It is also reachable *through other people's
browsers*: any page can embed `<img src="…/artist/x1">`, and every visitor spends one
render from their own address, which no per-address limit can see, including the one
added since.

**Fix, in order:**

1. `export async function generateStaticParams() { return []; }` on all three, so a repeat
   of a URL is served from the CDN as the `revalidate` already promises. A *new* slug is
   still a fresh render, so this is necessary, not sufficient.
2. Take the search off the artist page's server render: render the Deezer part, and let
   the song list come from `/api/search?q=<name>` in the browser — guarded, and sharing
   the search cache with everyone who typed the name.
3. If pages still fan out after that, meter them in `proxy.ts` (Next 16's middleware)
   against the same limiter.

---

# S-11 · A shared playlist can still break pages for good — through the fields inside a song `FIXED`

**Severity:** `MEDIUM` — A10:2025. The S-1 class, one level down. **Proven** against the
real modules.

**Fixed in `79940b9`.** `usableSongs` now rebuilds each song field by field
(`apps/web/app/song-shape.ts:4-43`). `artists` keeps strings only, each `sources` entry
must be an object with string `source` and `sourceId` (`:60-79`), and covers and
fallbacks go through `usableArtwork` (`:91-97`). A bad *field* is repaired; a record
that is not a song is dropped. `isPlayed` checks the artist elements and the cover's
type (`apps/web/app/player/history-store.ts:20-28`), `isKnown` checks every release
(`apps/web/app/taste-store.ts:28-45`), and `proxied()` and `sized()` return `null` for
a non-string (`apps/web/app/artwork-url.ts:12,43`). The three payloads below are
regression tests in `apps/web/app/song-shape.test.ts`. The same commit closed most of
S-15.

S-1's fix, `usableSongs`, checked that `id` and `title` were strings and that `artists`
and `sources` were arrays. It did not check what was *in* them, and did not look at
`artworkUrl`, `artworkFallbacks` or `from` at all. The import and the storage read both
go through it, so whatever it admitted was saved and came back on every load.

Three payloads, each in an otherwise ordinary export file:

- **`artworkUrl: 1`** (or `true`, `{}`). `summarise` (`apps/web/app/playlists/store.ts:36-44`)
  kept any truthy value as a cover (`:41`), and `proxied()` called `url.startsWith` on it
  (`artwork-url.ts:13`): *"url.startsWith is not a function"*, during render, wherever
  playlist covers draw — `/library`, `/profile`, `/playlist/[id]` and the sidebar's
  Playlists tab. Reproduced: the import returned 1, the record was persisted, the throw
  followed.
- **`sources: [null]`** — `<SourceBadges>` read `source.source`
  (`apps/web/app/source-badges.tsx:24-25`) on the playlist page.
- **`artists: [1]`** — the quiet one. It rendered and played. Once it had played,
  `recordPlay` wrote it into `timbre:history` (`apps/web/app/player/player-context.tsx:691`),
  whose own check read only `id` and `title`; from then on `useTaste` handed `1` to
  `normalizeLoose`, by way of `artistKey` (`taste-store.ts:96-97`,
  `apps/web/lib/genre-tally.ts:3`, `packages/core/src/normalize.ts:34-44`), and every
  Explore load threw *"input.normalize is not a function"*. Storage-to-throw was proven;
  the play step was traced by reading.

There was still only `global-error.tsx`, so each of these cost the whole shell rather
than one panel. (The only segment boundary since is S-10's retry notice on the artist
page.) S-2's backup-before-reset meant nothing was lost for good — but the reader had
to find the reset, and see S-16 for what that backup carried until its fix.

**Fix:** `usableSongs` checks element types — `artists` strings only; each `sources`
entry an object with string `source` and `sourceId` and string-or-null `url` and
`previewUrl`; `artworkUrl` string-or-null; `artworkFallbacks` strings only — dropping a
bad *element* rather than the song where the song survives it. The same for `isPlayed`
in `history-store.ts` and for `releases` in `taste-store.ts`'s `isKnown`
(`releases: [null]` also throws on Explore). And `proxied()` returns null for a
non-string instead of trusting its type. The payloads above are the regression tests.

---

# S-12 · Next.js 16.3.0 is inside two critical advisories published 2026-09-08 `FIXED`

**Severity:** `MEDIUM` for this deployment — critical upstream, mostly unreachable here.
A03:2025.

**Fixed in `5c56e98`.** `next` and `eslint-config-next` are `16.3.3`
(`apps/web/package.json:21,33`), and `pnpm-lock.yaml` resolves `next@16.3.3`. The
dev-server exposure below closes per checkout: a working tree is covered once it has
run `pnpm install` since.

`apps/web/package.json` pinned `next: 16.3.0`. Read from GitHub's advisory API directly,
not from a summary:

| Advisory | What | Affected | Fixed |
|---|---|---|---|
| GHSA-2xp9-vwfh-vxw4 | Unauthenticated RCE in the Image Optimization API through AVIF (`libheif` under `sharp`) | `>=16.0.0 <16.3.3` | 16.3.3 |
| GHSA-p293-qw3h-jr36 · CVE-2026-75604 | Unauthenticated RCE on **Windows-hosted** servers, App and Pages Router without Cache Components | `>=16.0.0 <16.3.3` | 16.3.3 |

**Where Timbre stood:**

- **Hosted — not reachable, as far as it can be checked from outside.** `/_next/image` is
  answered by Vercel's own optimizer (its error body is `INVALID_IMAGE_OPTIMIZE_REQUEST`),
  which serves only query-free local files: `?url=/icon-192.png` → 200,
  `?url=/api/art?u=…` → 400. With no `images` config there is no remote pattern, and no
  local file an outsider controls. Production is Linux.
- **This machine — treat as reachable.** `pnpm dev` is `next dev` on Windows, bound to
  `127.0.0.1`. Loopback keeps other hosts out, not the browser on the same machine: any
  page open in another tab can send requests to `127.0.0.1:3000`. Whether that is enough
  depends on the exploit's shape, which the advisory does not publish. Several sessions
  run this dev server daily.
- **The Docker escape hatch** runs `next start` with `sharp` in-process — both apply if it
  is ever used.

**Fix:** `next` (and `eslint-config-next`) to `16.3.3` or later. The cheapest change in
this document, and the first to do. Until then, do not leave `pnpm dev` running
unattended.

---

# S-13 · The release job runs every dependency's code while holding a write token `PARTLY FIXED`

**Severity:** `MEDIUM` — A03:2025 Software Supply Chain Failures.

**Fixed in `d00121a`, except the token's scope.** `release.yml` is two jobs now.
`verify` (`.github/workflows/release.yml:12-45`) holds `contents: read`, checks out with
`persist-credentials: false`, and runs the install, the checks, the build and the
`docker build`. `release` (`:47-108`) `needs: verify` and holds `contents: write`. It
checks out without persisting credentials, sets up Node with no cache, and installs
nothing. Git sees the workflow token only in the push, which is `--atomic` and names
`main` and the tag explicitly (`:70-83`); `RELEASE_TOKEN`, or the workflow token when it
is not set, goes only to `gh release create` (`:85-104`). `ci.yml` declares `contents: read` (`:8-9`) and neither
of its checkouts persists credentials. The canary's install job holds `contents: read`
only; its issue is filed from a separate job with `issues: write`, no checkout and no
install (`.github/workflows/spotify-canary.yml:49-98`).

**Still open:** make `RELEASE_TOKEN` a fine-grained token scoped to this repository.
That is a GitHub setting, not a file, and only the repository owner can change it.

S-3 pinned the actions; this is the job they ran in. `release.yml` declared
`contents: write` for its one job, checked out without `persist-credentials: false` —
so the token sat in `.git/config` — and then ran `pnpm install`, `typecheck`, `lint`,
`test`, `build` and a `docker build` (the steps that are now the `verify` job,
`release.yml:24-45`) before `node scripts/release.mts` and the push. Every package in
that graph, and every build script `allowBuilds` admitted, ran with that token on disk,
on the runner `RELEASE_TOKEN` was delivered to. That is the shape of the tj-actions and
Shai-Hulud token thefts. `release.mts` imports only Node built-ins, so the job that
writes needs no install at all.

**Fix:** split it. A `verify` job — `contents: read`, `persist-credentials: false` — runs
install, checks and build. A `release` job — `needs: verify`, `contents: write` — checks
out and runs `node scripts/release.mts`, then commits, tags and pushes: no
`pnpm install`, no setup-node cache. Make `RELEASE_TOKEN` a fine-grained token scoped to
this repository. While there: `ci.yml` had no `permissions:` block (it inherited the
repository default), and the canary's checkout left its `issues: write` token in
`.git/config` through `pnpm install` — `persist-credentials: false` on both; the `gh`
steps already take `GH_TOKEN` from the environment. And push the release with
`--atomic`, so a `main` that moved mid-run cannot leave a tag pointing off-branch.

---

# S-14 · The sidecar reads and parses the body before it checks the secret `FIXED`

**Severity:** `LOW` on Vercel, `MEDIUM` on the Docker path. A06:2025. **Measured
locally.**

**Fixed in `173feae`.** The secret is checked by a pure-ASGI middleware,
`RequireSharedSecret` (`apps/ytmusic/app/security.py:23-55`, installed at
`apps/ytmusic/app/main.py:10`), before any route or body is touched. Every path but
`/health` answers 401 at once without a matching secret. A declared `Content-Length`
over 16 KB, or one that is not a number, gets a 413 (`security.py:39-43`), and a body
sent without one is counted as it streams and refused past the same cap (`:45-53`).
With no secret, a malformed body, a valid one and one 400 times the cap all get a 401
with nothing read (`apps/ytmusic/tests/test_security.py:92-101`). Both halves below are
closed.

FastAPI 0.141.1 reads and JSON-decodes a route's body before it resolves the route's
dependencies (`fastapi/routing.py`, the body block ahead of `solve_dependencies`), and
the secret check, `require_shared_secret`, was a dependency. So:

- A 400 MB `POST /search` with **no secret** was read in full before the 401; the local
  server went from 60 MB to 865 MB resident. uvicorn sets no body limit and the
  Dockerfile's `CMD` adds none (`apps/ytmusic/Dockerfile:20`). On Vercel the platform's
  4.5 MB request cap bounded it; in a container, a few parallel uploads exhausted memory
  with no credential at all.
- No secret and `{bad` → **422** `json_invalid`; no secret and valid JSON → 401. An
  unauthenticated caller could tell the framework — the same class of tell S-7 removed.

**Fix:** a small pure-ASGI middleware that runs `matches()` on the header before the body
is read, for every path but `/health`, and refuses a `Content-Length` over ~16 KB with a
413 (capping chunked bodies too). It closes both.

---

# S-15 · Imported songs link and load wherever the file says `FIXED`

**Severity:** `LOW` — phishing and tracking. No script execution.

**Fixed in `79940b9` and `b18028f`.** Every stored or imported song passes
`usableSong` (S-11), which now also checks where its URLs point
(`apps/web/app/song-shape.ts:45-115`). A source's `url` is kept only if it is `https:`
on that source's own hosts (`:47-56,68`), and a `previewUrl` only if it comes from a
catalogue's CDN (`:58,69-70`). A cover (`artworkUrl`, each fallback, and an artist
context's `imageUrl`) is kept only if it is `https:` on a host `/api/art` proxies
(`:91-95`). An Audius-shaped cover path on any other host is rewritten onto
`api.audius.co` rather than trusted (`:88-89,96`, from `b18028f`), so a planted cover can
no longer be a request to the file author's server. The lookalike *Open on Spotify* link
and the tracking cover below are both dropped, on import and on read. What remains is
by design: `proxied()` still passes an unlisted `https:` host straight to the browser
(`apps/web/app/artwork-url.ts:11-15`), for covers that arrive live from the providers
rather than from a file.

Neither `sources[].url` nor `artworkUrl`/`previewUrl` was checked for scheme or host, on
import or on read.

- **Links.** `sources[].url` becomes the "Open on <Service>" arrow
  (`apps/web/app/source-badges.tsx:52-62`), the "Can't play this here ↗" banner
  (`apps/web/app/player/now-playing.tsx:170-176,216-226`) and the copy-link button
  (`apps/web/app/shell/source-link.tsx:25-49`).
  `{source: "spotify", url: "https://accounts-spotify.example/login"}` rendered as *Open
  on Spotify* — a credible lure in an app with a real Spotify sign-in. `javascript:`
  does **not** work: React 19.2 replaces it in `href`, `src` and `action` with a URL
  that throws (`react-dom-client.production.js`), in production as well as development.
- **Artwork.** Since the Audius work, `proxied()` passes any `https:` host that is not on
  the allowlist straight to the browser (`artwork-url.ts:11-15`) — on purpose, since
  Audius content nodes cannot be enumerated. So an imported `artworkUrl` was fetched by
  the victim's browser from the file author's host every time `/library` or `/profile`
  rendered: address, user agent, time. Several players draw artwork in plain `<img>`
  without `proxied()` at all, and `previewUrl` goes into an `<audio>` element. For
  imported data that contradicted `apps/web/app/privacy/page.tsx:71` ("No analytics,
  tracking pixels or advertising identifiers"), and it made the "Hostile artwork URLs"
  row below stale.

**Fix:** on import and on read, keep a source's `url` only when it is `https:` on that
source's own domain — or rebuild it from `sourceId`, which every source can. Drop
imported artwork and preview URLs whose host is neither in `ALLOWED_HOSTS` nor of the
Audius content-node shape.

---

# S-16 · The Spotify connection leaks into places its token store says it never goes `FIXED`

**Severity:** `LOW`.

**Fixed in `d57c4a6`.** The crash screen's backup leaves out every `timbre:spotify*` key
(`apps/web/app/global-error.tsx:9-13`). The service worker no longer handles anything
under `/spotify/` (`apps/web/sw/sw.ts:34`). The callback checks `state` before it reads
`error`, and shows a fixed sentence for any code but `access_denied`
(`apps/web/app/spotify/connection.ts:51-55`). Of the two cache fixes offered below, the
first was taken, so every other navigation is still cached under its full URL
(`sw.ts:36,51-53`). A crafted callback link still ends a sign-in in progress, because
the verifier and state are cleared before any check (`connection.ts:49`), but it can no
longer choose the words.

When the pass was written, `token-store.ts` opened with a comment saying the tokens are
"never sent anywhere". The trim removed the comment; the "Spotify OAuth (PKCE)" row below
is what checks the claim. Two paths put the tokens, or what mints them, somewhere else:

- **The crash screen's backup.** `global-error.tsx` wrote every `timbre:*` key, raw,
  into `timbre-storage-backup.json` (`:7-23`) — including `timbre:spotify`, the access
  **and refresh** token. The screen calls that file the only way back (`:84-88`), which
  makes it exactly the file a reader keeps, or sends to whoever offered to help.
  **Fix:** leave `timbre:spotify*` out of the dump. A reconnect is cheap; a leaked
  refresh token is not.
- **The service worker's shell cache.** Every successful same-origin navigation was
  cached under its full URL (`sw.ts:51-53`, `networkFirst`), except `/api/*` and
  `/profile`. So `/spotify/callback?code=…&state=…` landed in `timbre-v3-shell` — after
  the callback page went out of its way to strip the code from history
  (`apps/web/app/spotify/callback/page.tsx:24`). Low: the code is single-use and useless
  without the PKCE verifier. **Fix:** skip `/spotify/`, or key navigations without their
  query string (which also stops the cache growing with every artist and collection ever
  visited).

**Related, and not a leak:** the callback printed the `error` query parameter verbatim,
before any state check —
`/spotify/callback?error=Your%20account%20is%20locked.%20Verify%20at%20spotify-help.example`
showed that sentence under "Spotify could not connect", and cancelled a sign-in in
progress. Plain text, not a link. **Fix:** map Spotify's documented error codes to fixed
sentences, and ignore `error` when `state` does not match.

---

# S-17 · Smaller server-side gaps `FIXED`

**Severity:** `LOW` each. Hardening — none is reachable through the UI today.

**Fixed in `d57c4a6` and `18583c7`**, point by point, at the lines cited below. One
deliberate difference from the fixes as written: `/api/resolve` and the two predicates
accept `http:` as well as `https:`, so a pasted `http://` link keeps working, while
`javascript:` and `data:` are refused (`apps/web/app/api/resolve/route.ts:10`).
`spotifyCollectionOf` no longer exists; the trim deleted it as dead code (`7c0d2ee`).
Its browser-side counterpart, `spotifyCollectionPath`
(`apps/web/app/spotify/collection-link.ts:3-14`), still checks only the hostname, but
all it returns is an internal `/collection/spotify-…/<22 alphanumerics>` path, so a
scheme has nowhere to go.

- **URL predicates accepted any scheme.** `isSoundCloudUrl`
  (`packages/providers/src/soundcloud.ts:47-55`), `spotifyTrackId`
  (`packages/providers/src/spotify.ts:45-53`) and `spotifyCollectionOf` checked
  `hostname` only, and WHATWG parsing gives `javascript://soundcloud.com/%0aalert(1)`
  the hostname `soundcloud.com`. `/api/resolve`'s `z.url()` (zod 4.4.3) accepted
  `javascript:` — verified. Were SoundCloud's oEmbed ever to answer for such a URL,
  `resolve` would have echoed it back as the song's `url`. Three things stood in front
  of that — the search box resolves only `^https?://`
  (`apps/web/app/search-results.tsx:56`), `/api/resolve` is uncached, React neutralises
  `javascript:` hrefs — but the server should not be leaning on the client. **Fix:**
  require `https:` in all three, and `z.url({ protocol: /^https$/ })`.
- **Link URLs built by concatenation.** `` `${WEB}${raw.permalink}` `` and
  `` `${WEB}${raw.key}` ``, now built with `URL.parse` and kept only on their own origin
  (`packages/providers/src/audius.ts:54-57`, `packages/providers/src/mixcloud.ts:13,17,27`):
  a value starting `@evil.example/` made the host `evil.example`. The platforms generate
  those values, so this was theoretical. **Fix:** `new URL(path, WEB)`, then check the
  host.
- **`/collection/playlist/<id>` had no numeric check** (`apps/web/lib/collection.ts:79-104`,
  the check now at `:80`), unlike its `genre` and `radio` neighbours. The id arrives
  decoded, so `..%2Fuser%2F5` walked to another path on `api.deezer.com`. The host is
  fixed and the data public — content spoofing at most, and any public Deezer playlist
  already puts a stranger's title on a Timbre page. **Fix:** `/^\d+$/`.
- **`/api/spotify`'s memo key joined fields with `:`**
  (`apps/web/app/api/spotify/route.ts:23`), and titles contain colons, so two different
  lookups could share a key and the first answer served both for the instance's life.
  Exploiting it needed the resolver to answer the attacker's split with a wrong-but-real
  id. **Fix:** `JSON.stringify([isrc, artist, album, title])`.
- **Spotify's hash self-repair trusted two unpinned sources**
  (`packages/providers/src/spotify-web.ts:9-10,237-238`): SpotifyScraper's table from
  `raw.githubusercontent.com/…/master`, and a bundle URL read out of the page with no
  host check. The table is now read at a pinned commit, and the bundle is fetched only
  from `open.spotifycdn.com` (`:8,238`), its search chunk resolved against that same URL
  (`:204`). Whoever controlled either source chose which of Spotify's persisted queries
  Timbre ran; the answer is still shape-parsed into tracks, so the reach was wrong
  results, not code. **Fix:** pin the bundle host (`open.spotifycdn.com`) and pin the
  table to a commit — the canary already says when the table goes stale.

---

# S-18 · Sidecar robustness `PARTLY FIXED`

**Severity:** `LOW` each. **Measured locally**, with a dummy secret and a fake client —
nothing reached YouTube.

**Fixed in `173feae`, except two things.** Video ids are matched with `fullmatch`
throughout, and `resolve` drops an upstream `videoId` that fails the pattern. A
`RequestValidationError` handler returns the issues without their `input`
(`apps/ytmusic/app/main.py:13-18`). Numeric fields use `isdecimal()`, and the thumbnail
and its `width` and `height` are type-checked before use. Both images are pinned by
digest, uv by version, and the lock is exported with hashes and installed with
`--require-hashes`. `.dockerignore` carries every pattern the fix below asks for. Each
of these is at the lines cited below.

**Still open: the secret-strength check only warns, deliberately.** A secret under 32
characters logs a warning at boot instead of refusing to start
(`apps/ytmusic/app/config.py:4,18-23`). The length of the secret deployed on Vercel could
not be verified, and refusing to boot would have taken the sidecar down on the next
deploy. It can become a refusal once the deployed secret is known to be long enough.
**uv itself followed in `c124f7c`:** it now comes from `ghcr.io/astral-sh/uv:0.12.5`
pinned by digest, in a build stage that never reaches the final image, and CI builds the
sidecar image on every push.

What the pass found:

- **`VIDEO_ID` admitted a trailing newline.** `^[A-Za-z0-9_-]{11}$` with `.match`
  (now `apps/ytmusic/app/routes/search.py:17,61-84`, unanchored, with `fullmatch`):
  Python's `$` matches before a final `\n`, and `parse_qs` decodes `%0A`, so
  `watch?v=dQw4w9WgXcQ%0A` reached `get_song` with the newline and could come back as
  `"video_id"`. No injection — the id travels in a JSON body to a fixed endpoint — but
  the web side puts `video_id` into a URL unencoded (`packages/providers/src/ytmusic.ts:55`).
  `RadioRequest`'s pydantic pattern is unaffected. **Fix:** `fullmatch`, and check
  upstream's `videoId` against the same pattern (now `search.py:103-105`).
- **A lone surrogate was a 500, not a 422** (behind the secret): pydantic rejects
  `"\ud800"`, FastAPI's default handler echoed the input back, and rendering it raised
  `UnicodeEncodeError` — S-7's shape, behind auth. **Fix:** a `RequestValidationError`
  handler that omits `input`, which also stops echoing 2,000-character inputs.
- **Odd upstream shapes were 500s:** a list-valued `thumbnail` and `lengthSeconds="²"`
  passing `isdigit()` then failing `int()` in `resolve` (now `search.py:107-118`), the
  same `isdigit()` in `normalize.py`'s display-duration parse, and a string thumbnail
  `width` (now `apps/ytmusic/app/normalize.py:7-18,46`). YouTube generates those fields,
  so this was robustness, not attack — but at the pass `normalize.py`'s docstring
  promised to degrade a moved or vanished field to `None` rather than fail the request.
  The trim removed the docstring; `apps/ytmusic/tests/test_normalize.py:78` and
  `apps/ytmusic/tests/test_url_extraction.py:79` now hold the code to it. **Fix:** `isdecimal()`,
  `isinstance` checks, and drop the item that fails rather than the response.
- **No minimum secret strength** (`require_secrets`, `config.py:11-24`, booted on
  `dummy`). With no rate limit and no 401 logging (E-12), a weak secret on the container
  path is guessable. **Fix:** refuse to start below 32 characters.
- **Dockerfiles.** `python:3.12-slim` and `node:22-slim` were pinned by tag, not digest
  (now `apps/ytmusic/Dockerfile:1`, `Dockerfile:1`); `pip install uv` unpinned; the lock
  exported `--no-hashes` (now `apps/ytmusic/Dockerfile:10-12`). `.dockerignore` excluded
  `.env*` at the context root only, so a nested `apps/*/.env`, a `.vercel/` (which holds
  an OIDC token once linked), `notes/` or a local `.next-*` build would have entered the
  root image through `COPY . .` — none existed. **Fix:** digests, `uv==<ver>`,
  `--require-hashes`; add `**/.env*`, `!**/.env.example`, `**/.vercel`, `notes`,
  `**/.next-*` and `*.pem` (now `.dockerignore:1-5,16`).

---

# S-19 · Tooling and repository hygiene `PARTLY FIXED`

**Severity:** `LOW`.

**Fixed in `5c56e98` and `d00121a`, except the `.env` leftovers.** `packageManager` is
`pnpm@11.11.0` (`package.json:20`). `.gitignore` adds `.env~`, `*.bak`, `*.pem`,
`*.key`, `id_rsa*`, `id_ed25519*`, `secrets.json` and `.npmrc` (`.gitignore:16-23`);
every name listed below now checks as ignored with `git check-ignore`, at the root and
under `apps/ytmusic`. `.github/dependabot.yml` moves the npm, uv and Actions
dependencies weekly. The `esbuild` build allowance is gone (`pnpm-workspace.yaml:5-7`).
The canary wraps each detail in inline code, with backticks and runs of whitespace
(newlines included) collapsed to a space and `|` escaped
(`scripts/spotify-canary.mts:152,165`).

**Confirmed present 2026-09-13, and still open.** `.env` is untracked, so no commit
shows it — read directly instead, key names only. All of the leftovers are there:
`DATABASE_URL`, `TIMBRE_ENCRYPTION_KEY`, `AUTH_SECRET`, `EMAIL_SERVER` and `EMAIL_FROM`,
beside the four keys that are actually read. Nothing loads them — `lib/env.ts` parses a
fixed schema and ignores the rest — so this is not a live path. It is dead credential
material sitting in a file, and two of those names are secrets rather than settings.

**Removed the same day, in place, on the owner's say-so.** `.env` now holds five keys and
nothing else: the two `YTMUSIC_*`, the two `SOUNDCLOUD_*` and `SOUNDCLOUD_DIRECT_API`. No
copy was taken — a second file holding the same secrets is worse than the thing being fixed
— so the edit rewrote the file in place, carrying the live secret across without rendering
it. Verified after: the file parses to five keys, `YTMUSIC_SERVICE_URL` is a URL, and
`app.config` boots with one secret configured.

**None of the five needed rotating, which was worth checking rather than assuming.** The
question this entry asked — whether the dead credentials still authenticate anywhere — has
a better answer than "unknown" once they have been read. The Postgres URL pointed at
`localhost` with the default user and password, against a database deleted along with
accounts; it was never a remote credential. The encryption key and the auth secret were
generated locally and are not credentials *to* anything: the first decrypts a `connections`
table that no longer exists, the second signs sessions for auth code that no longer exists.
The email pair was a Mailpit address on `localhost` and carried no password at all. So what
was sitting there was five dead values rather than five live ones — but that is a finding,
not a presumption, and the difference is exactly why they were read before being deleted.

**The live secret is a separate matter, and is open.** `YTMUSIC_SHARED_SECRET` is 64 hex
characters, comfortably past `MIN_SECRET_LENGTH`, and is the one value in the file that
authenticates anything. It was disclosed to a transcript on 2026-09-13 and should be
rotated. The sidecar's comma-separated list exists precisely so that can happen without
downtime, and the deployed environment has to move with it.

- **pnpm 11.10.0** (`packageManager` in `package.json:20`) was inside
  GHSA-c59q-g84q-2gj5 · CVE-2026-82392 (`>=11.0.0 <11.11.0`, high): a crafted
  `pnpm-lock.yaml` writes files outside the project on install. The unusual part here
  is how many agent sessions edit the lockfile. **Fix:** `pnpm@11.11.0` or later.
- **`.gitignore`** did not cover `*.pem` at the root or under `apps/ytmusic` (only
  `apps/web/.gitignore` did), nor `id_rsa`, `.env~`, `env.bak`, `secrets.json` or
  `.npmrc` — each checked with `git check-ignore`. `.env`, `.env.*` and `.vercel` were
  covered.
- **No `.github/dependabot.yml`**, though S-3 relied on Dependabot to move the SHA pins,
  and so did a comment in `release.yml` that the trim has since removed. The twelve pins
  were right — each resolved against its tag — and nothing would have updated them.
- **`allowBuilds: esbuild: true`** (`pnpm-workspace.yaml`) pre-approved a build script
  for a package no longer in the lockfile; if it returned as a transitive dependency, its
  postinstall would run unasked. Remove it.
- **The canary pasted Spotify's text into GitHub issues**
  (`scripts/spotify-canary.mts:165`, escaping only `|`): titles and error text from a
  third-party catalogue could carry links, images and `@mentions` into an issue. Private
  repository, so mentions reach nobody outside it; hashes are hex-checked, so the code
  fence holds; no `${{ }}` reaches a shell. **Fix:** inline-code each detail and strip
  newlines and backticks.
- **`.env` holds four keys nothing reads** — `DATABASE_URL` (a local Postgres),
  `AUTH_SECRET`, `TIMBRE_ENCRYPTION_KEY`, `EMAIL_*`; `RUNNING.md` already calls them
  leftovers. Harmless, but a secret nobody uses is one nobody rotates. Delete them,
  editing `.env` in place.
- **Secrets in history — re-checked, still clean.** Every commit on every ref, including
  `backup/*` and `refs/original`, scanned for key, token, private-key, connection-string
  and long hex/base64 patterns. The only hits are three placeholder `postgresql://` URLs
  (`Dockerfile`, `docs/DEPLOY.md`, `.env.example`). No `.env`, `.pem` or `.vercel` file
  has ever been committed.

---

# S-21 · A live search draws covers from hosts nobody vetted `FIXED`

**OWASP:** A01:2025 Broken Access Control, as a privacy boundary rather than an authorisation
one — and the mirror of S-20: that one was what the route *accepts*, this is what the browser
*fetches* without ever reaching the route.

**Fixed in this pass.** `proxied()` fails open by design — a host that is not on the
allowlist is returned unchanged rather than dropped (`apps/web/app/artwork-url.ts:16`), so the
picture still loads, just not through `/api/art`. The "Hostile artwork URLs" row below argues
that is safe because a cover is "kept only on a host `/api/art` proxies, or as an Audius
content path rewritten onto `api.audius.co`". That is true of `usableArtwork`, and
`usableArtwork` runs on a song read back out of **storage** — playlists, likes, the charts
cache, a tab-sync handoff.

**A live search result is neither imported nor stored.** `/api/search`, `/api/radio` and
`/api/resolve` are consumed exactly as they arrive, in six places (`search-results.tsx:73`,
`queue-search.tsx:46`, `player-context.tsx:106` and `:627`, `artist-view.tsx:59`,
`home-shelves.tsx:68`). Nothing sanitises them, because nothing needed to while every provider
minted covers on its own CDN.

**Audius does not.** It stores covers on community-run content nodes and names whichever hold
the track. One call to `/v1/tracks/trending` on 2026-09-13 answered with
`audius-creator-7.theblueprint.xyz`, `cn1.mainnet.audiusindex.org`, and in `artwork.mirrors`
`val014.open-audio-validator.com` and `v.monophonic.digital`. So searching anything with an
Audius hit had the listener's browser fetch from operators nobody vetted: address and user
agent disclosed, and the allowlist, the 8 MB cap and the raster-only content-type check all
skipped, because the request never touched the route that enforces them. `img-src` would not
have helped — it is `https:`, deliberately wide.

**Not code execution.** A cover is an `<img src>`; a script cannot run from one, and
`usableArtwork` still governs anything that gets saved.

**The fix** rewrites the cover in the provider (`packages/providers/src/audius.ts`), keeping
the `/content/<cid>/<size>.jpg` path and dropping the host, so the URL is already on
`api.audius.co` — and therefore already allowlisted, and already the shape S-20 pinned —
before it leaves the server. `api.audius.co` serves the identical bytes, checked against a
live cover: same length, same type. That makes the mirrors the same URL as the primary, so
`artworkFallbacks` is no longer carried for Audius. Twelve assertions added.

**`artworkFallbacks` is now dead plumbing**, still threaded through `types.ts`, `merge.ts:64`,
`song-shape.ts` and the progressive player. It was left in place: a song stored before this
change can still carry one, and `usableArtwork` sanitises it on read.

---

# S-22 · Two players set an `<img src>` without proxying it `FIXED`

**Severity:** `LOW` on its own, and the delivery mechanism for S-21.

**Fixed in this pass.** Every cover in the app draws through `<Artwork>` or `cover()`, and
both call `proxied()`. Four did not, setting `src` to the raw URL: the progressive player
(`progressive-audio-player.tsx:112`), SoundCloud's expanded view (`soundcloud-player.tsx:190`)
and Mixcloud's and Spotify's panels. For those last three the host is an allowlisted vendor
whose iframe the page already loads, so what was lost is the proxy, not the boundary. The
progressive player is the one that plays Audius, and it also walks `artworkFallbacks` on
error — one failed load per mirror host, each fetched in turn.

**All four are fixed now.** The first two in this pass; Mixcloud's and Spotify's were left
because another session held both files while it ran, and were finished once that session's own
work in them had landed. Same one-line change in each.

---

# S-23 · History and the play log kept covers a playlist would have refused `FIXED`

**Severity:** `LOW`, and what turned S-21 from a leak into a standing one.

**Fixed in this pass.** A playlist and a liked song are read back through `usableSong`. The
history store and the play log had their own weaker checks — `isPlayed` accepted any string as
`artworkUrl` (`history-store.ts:26`), and `parsePlayLog` kept the whole song object on `id`
and `title` alone (`play-log.ts:41`).

So the cover that leaked during a search did not leak once. It was written to `localStorage`
and drawn again from the same third-party host on every later visit to the home and stats
pages, with no second search. Both now run `usableArtwork`, which also rewrites or drops what
is already sitting in browsers, on read. Seven assertions added across two new files.

---

# S-24 · The sidecar waited five times longer than anyone was listening `FIXED`

**OWASP:** A06:2025, availability.

**Fixed in this pass.** `ytmusicapi` pins its session to `timeout=30` (`ytmusic.py:233`); the
web app gives up on the sidecar after 6s (`packages/providers/src/request.ts:5`). Every route
in the sidecar is a synchronous `def`, so FastAPI runs it in anyio's thread pool — 40 slots.
On a slow YouTube each abandoned request therefore held a slot for another 24 seconds after
the only caller had walked away and retried.

`/health` is a synchronous `def` too, and the one route the shared-secret middleware lets
through, so exhausting that pool also stops the check the web app uses to decide the sidecar
is alive — the failure reports itself as the wrong thing. `routes/lyrics.py:16` sharpens it: a
module-level `_mobile_lock` serialises every lyrics request process-wide, so they queue behind
one 30s timeout at a time.

**The fix** gives the client a session bounded at 8s — above the caller's deadline, so the
sidecar is never the first to give up on a request someone is still waiting for, and far
enough under 30 that an abandoned one frees its thread. `_prepare_session` returns a supplied
session untouched, so the bound is not re-wrapped by the default. **`_mobile_lock` is
unchanged**, and the sidecar still has no rate limiter of its own.

---

# S-25 · Smaller edges `FIXED`

- **A backslash reached a Lucene phrase.** `/api/radio?artist=` is interpolated into
  `creator:"..."` for the Archive etree search (`packages/providers/src/archive.ts:46`). The
  quote was stripped, the backslash was not, and a trailing backslash escapes the closing
  quote — so a name ending in one closed the phrase early and the rest became query syntax.
  It steers an archive.org search and discloses nothing. Both characters are dropped now.
- **A percent in an artist name answered 500.** Next hands the route segment over already
  decoded, so `/artist/100%25` reached `decodeURIComponent` as `100%` and it threw `URIError`
  (`apps/web/app/artist-slug.ts:15`). `generateMetadata` calls the same helper and runs
  outside the route's error boundary, so a crafted URL got a 500 rather than the empty state
  `error.tsx` exists to show. Decoding now falls back to the raw segment.

---

# S-26 · No upstream read has a size cap `OPEN`

**Severity:** `LOW`. **Not fixed.**

`/api/art` caps a body at 8 MB and streams it through a counter. Nothing else caps anything.
`spotify-web.ts:85`, `:224` and `:489`, `spotify.ts:127` and `soundcloud-client-id.ts:20` all
call `.text()` unbounded. The hash-discovery read at `:224` pulls Spotify's web-player bundle
on a 20s deadline — megabytes — and `soundcloud-client-id.ts` drops its `bytes=0-65535` range
on the second pass and reads whole bundles.

Every one of those hosts is a vendor rather than an attacker, which is why this is low and why
it was not fixed in the same pass as the rest: the bound wants to live in `createRequester`,
where it applies once to every provider, and that is a wider change than the others here.

---

# Verified correct — do not re-investigate

Each of these is a place a vulnerability would normally be, and is not.

| Area | Finding | How it was checked |
|---|---|---|
| **DOM XSS** | Exactly one `dangerouslySetInnerHTML` (`app/layout.tsx:246`), and it renders a module constant with no interpolation of any kind. **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` anywhere** in `apps/web` or `packages`. | grep across all `.ts`/`.tsx` |
| **postMessage** | **No `message` listeners and no `postMessage` calls in the entire codebase.** For an app built around two third-party iframe players, this is the single most likely XSS hole and it is absent — the vendor SDKs own that channel and Timbre never opens its own. | grep across all `.ts`/`.tsx` |
| **SSRF via `/api/resolve`** | The user's URL is never fetched. The YouTube path posts it to the sidecar, which regex-extracts an 11-character video id against a host allowlist (`routes/search.py:139-166`) and only ever calls `get_song(id)`. The SoundCloud path gates on `isSoundCloudUrl` and then passes the URL as a *query parameter* to a fixed oEmbed endpoint. Neither reaches an attacker-chosen host. | read both providers end to end |
| **Hostile artwork URLs** | **Holds again, by a different route — S-15, fixed in `79940b9` and `b18028f`.** The pass found this stale: `proxied()` passes an unlisted `https:` host straight to the browser (`apps/web/app/artwork-url.ts:11-15`), so the 403 below no longer happened. `proxied()` still does that, but an imported or stored cover no longer gets that far: it is kept only on a host `/api/art` proxies, or as an Audius content path rewritten onto `api.audius.co` (`apps/web/app/song-shape.ts:88-97`), and dropped otherwise, before it is saved or drawn. Script still cannot run from an `img src`. *Original row:* Every cover renders through `<Artwork>`, which always calls `proxied()` — so an imported `artworkUrl` pointing at an attacker's host goes to `/api/art`, fails the allowlist, 403s, and falls back to the placeholder. Non-HTTPS URLs pass through unproxied, but `javascript:` cannot execute in `img src` and `http:` is blocked as mixed content on an HTTPS deployment. | read `artwork.tsx` + `artwork-url.ts`; since S-15, `song-shape.ts` |
| **Prototype pollution** | The import spreads parsed JSON (`{...playlist}`). Object spread uses `CreateDataProperty`, so a `__proto__` key becomes an ordinary own property rather than mutating the prototype. Not exploitable. | language semantics + read |
| **ReDoS** | No nested-quantifier patterns in any regex in `core`, `providers`, `lib` or `app`. The LRC timestamp parser — the one regex applied to untrusted upstream text on the server — is `\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]`, linear. | pattern scan across the tree |
| **JS dependencies** | **Holds again for the two advisories that made it stale — S-12 and S-19, fixed in `5c56e98`.** The pass found `next` 16.3.0 and `pnpm` 11.10.0 each inside an advisory published after this row was written; they are now 16.3.3 and 11.11.0, the fixed versions. `pnpm audit` was not re-run (it uploads the dependency list), so the rest of this row still dates from 2026-08-21. *Original row:* `pnpm audit` — **no known vulnerabilities**, at every severity level. | ran it (2026-08-21) |
| **Secrets in history** | `.env` has never been committed on any branch. Every commit matching `YTMUSIC_SHARED_SECRET=` is `.env.example`, documentation, or the CI placeholder `ci-placeholder`. | `git log --all` pickaxe |
| **Timing attacks** | `hmac.compare_digest` on the shared secret, results accumulated rather than short-circuited so a rotation cannot leak *which* secret matched. Correct — but this row read the comparison for timing and missed that its arguments could raise. See **S-7**. | read |
| **Input bounds** | Enforced at both edges. Pydantic: query ≤ 500 chars, `limit` 1–50, `video_id` regex-pinned, URL ≤ 2000. Zod on every web route: same shape. Profile images are capped at 25 MB (5 MB animated) before decode. | read `models.py`, all 8 routes, `image-resize.ts` |
| **Error disclosure** | The sidecar maps every upstream failure to a flat `502 "YouTube Music <action> failed."` and logs the detail server-side rather than returning it (`errors.py:14-22`). No stack traces, no upstream text, no version. FastAPI's `/docs`, `/redoc` and `/openapi.json` are all explicitly disabled. | read `errors.py`, `main.py` |
| **Access control & CSRF** | Largely inapplicable **by design**, and that is worth stating: there are no accounts, no sessions, no server-side user state, and no authenticated state-changing endpoint. Every mutation happens in the visitor's own browser against their own storage. There is nothing for a forged cross-site request to accomplish. | architecture |
| **DOM XSS, re-checked 2026-09-11** | Still exactly one `dangerouslySetInnerHTML` (`layout.tsx`, a constant), still no `innerHTML`, `srcdoc`, `document.write`, `eval`, `new Function`, string timers, `message` listeners, `postMessage` or `BroadcastChannel` in `app`, `sw` or `lib`. And a layer the first row did not count: React 19.2 rewrites `javascript:` in `href`, `src`, `action` and `formAction` to a URL that throws, in production too — which is why S-15 is phishing rather than XSS. | grep + `react-dom-client.production.js` |
| **Embed and stream URLs** | Every id reaching an iframe, a pop-up or an `<audio>` is `encodeURIComponent`-ed onto a fixed host — Spotify panel, Mixcloud, SoundCloud, Apple/Deezer, Audius. The raw cases (Archive paths, Spotify's `createController` URI, YouTube's `loadVideoById`) can only change a path on their own host. | read every player |
| **Spotify OAuth (PKCE)** | `state` is 32 random characters compared before the code is exchanged; verifier and state live in `sessionStorage` and are removed on first read; each code is exchanged once; the redirect URI is the origin plus a fixed path; there is no `next`/`returnTo`; tokens go only to `accounts.spotify.com` and `api.spotify.com`, never to `/api/*` or a log. What S-16 added was where copies ended up, not a flaw in the flow; since its fix the callback also checks `state` before it reads `error`. | read `pkce.ts`, `connection.ts`, `callback/page.tsx` |
| **The anonymous Spotify token** | Held in server memory only (`packages/providers/src/spotify-web.ts:72`), never serialised, never in a response — `/api/spotify/search` returns mapped tracks. Collection ids are pinned to 22 alphanumerics before any fetch (`spotify-web.ts:498`). | read |
| **Server-side Deezer paths** | Every id reaching `api.deezer.com` is numeric-checked, validated against the published genre list, or regex-extracted from a profile URL — `/collection/playlist` too since S-17's fix (`apps/web/lib/collection.ts:80`). | read `lib/*` |
| **Sidecar authentication** | `/search`, `/resolve` and `/radio` return 401 without the secret; only `GET /health` is open, with a fixed body; `/docs`, `/redoc`, `/openapi.json` 404. `"dummy, ,,other,"` parses to `('dummy','other')`, so an empty secret can never match; missing, empty, whitespace, `café` headers all 401 (S-7 holds). 200k fuzzed URLs through the id extractor raised nothing. Since S-14 the check is one middleware in front of every path but `/health` (`apps/ytmusic/app/security.py:23-55`), so the `/playlist` and `/lyrics` routes added after this pass are covered the same way. | run locally, dummy secret; since S-14, `apps/ytmusic/tests/test_security.py` |
| **Python dependencies** | fastapi 0.141.1, starlette 1.6.0, pydantic 2.13.4, uvicorn 0.52.3, ytmusicapi 1.12.2, requests 2.34.2, urllib3 2.7.0, h11 0.16.0, idna 3.18, python-dotenv 1.2.3 — none inside a published advisory. urllib3 2.7.0 is exactly the fixed version for its 2026 pair, so do not let it slide back. | advisory pages, read by hand |
| **React Server Components advisories** | Next 16.3.0 bundled `react-server-dom-*` from a canary built after every RSC advisory to date, including CVE-2025-55182 ("React2Shell") and GHSA-wx67-qw84-cm4g; `react`/`react-dom` 19.2.8 is the patched line. The Turbopack single-locale proxy bypass (GHSA-6gpp-xcg3-4w24) was fixed in 16.2.11, and there was no `proxy.ts` to bypass then. There is one now — S-10's page meter, `apps/web/proxy.ts` — and 16.3.3 (S-12) is past that fix. 16.3.3 bundles `react-server-dom-*` `19.3.0-canary-cbb046ab-20260731`; that build has not been re-checked against the advisories. | GitHub advisory API |
| **GitHub Actions** | All twelve `uses:` were full SHAs matching their tag comments. S-13's split brings the count to fifteen, all still full SHAs; the two new actions, `actions/upload-artifact` v7.0.1 and `actions/download-artifact` v8.0.1, resolve to their pinned SHAs (`git ls-remote`, 2026-09-11); no `pull_request_target` or `workflow_run`; `release.mts` writes only integer version parts to `GITHUB_OUTPUT`; every script uses `execFileSync` with argument arrays; `vercel-ignore.sh` only `case`-matches the commit message. S-13 is about the job's *credentials*, not these. | read + public action repos |
| **ReDoS, new regexes** | Every single-argument normaliser in `@timbre/core` run over adversarial 300-character inputs: slowest 3.2 ms. The new patterns in `spotify-web.ts` build their dynamic `RegExp`s from digits or constants only. | measured |

# S-20 · The artwork proxy admitted two hosts that also answer an API `FIXED`

**OWASP:** A10:2025 Server-Side Request Forgery, at the low end of it — the request goes,
nothing comes back.

**Fixed in this pass.** `/api/art` takes a URL and fetches it, and the only bound was a host
allowlist. That is the right shape while every entry is an image CDN, which was true until
`7f4bd46` added `api.audius.co` so Spotify's and Audius's covers could tint. Two entries then
answered a general API on the same name: `api.audius.co`, and `archive.org`, whose
`/metadata/` and `/advancedsearch.php` paths the archive provider itself calls.

`usableArtwork` (`apps/web/app/song-shape.ts:91`) pins Audius covers to
`/content/<cid>/<size>.jpg`, but that governs what Timbre **mints**, not what the route
**accepts** — `/api/art?u=` took any path on a listed host. So a caller could aim the
server's outbound requests at arbitrary Audius or Archive API paths, 300/min, with
attacker-chosen query strings.

**Nothing was disclosed.** The route returns 404 unless the reply is a raster image
(`apps/web/app/api/art/route.ts:22-26`), and both hosts answer `application/json` on their
API paths — checked against `https://api.audius.co/v1/tracks`, which is refused on exactly
that ground. The body is cancelled, never forwarded. What remained is that the request was
made at all.

**The fix** adds `ALLOWED_PATHS` to `apps/web/lib/artwork-proxy.ts`: a host listed there must
match its path pattern as well as its name, the two patterns being the shapes
`packages/providers/src/archive.ts:70` and the Audius rewrite actually produce. `allowed()`
enforces it, and `proxied()` and `usableArtwork()` were moved onto that one predicate so all
three agree — `artwork-url.ts` previously decided with the bare host set and could hand the
route a URL it would refuse. Six assertions added to `artwork-proxy.test.ts`.

This is the class EXPOSURE **E-7** describes. A signature on `u` is still the boundary and a
path pin only a tighter bound, so E-7 stays open — but note why the obvious fix does not
drop in: `proxied()` runs inside client components, which cannot hold a signing key. Closing
E-7 means moving artwork URL minting server-side, not adding an HMAC where `proxied()` is.

---

---

# Status

**All six are fixed**, in `f363aa0`, `e561412`, `1e2e536`, `8f10eef` and `2598c93`.
The suite went from 71 to 86 tests on the web side and 49 to 55 on the sidecar; the
four that cover S-1 fail against the previous store, which was checked by running
them against it.

**S-7 and S-8 are fixed too**, from the second pass. The sidecar suite is 55 → 56
and the providers suite 65 → 69; `pnpm test` is 223 across the workspace, with
`typecheck`, `lint`, `ruff` and a production build all clean. EXPOSURE **E-10** was
closed in the same pass, and the display name gained the length cap E-15 implies.

What that leaves, none of it a vulnerability:

- **Flip the CSP from `Report-Only` to enforcing** once a browser has confirmed it
  breaks nothing. See EXPOSURE **E-14** for why a strict `script-src` is not
  available here and what the policy does buy.
- **Sign the `u` parameter on `/api/art`**, so only URLs Timbre produced are
  fetchable. The allowlist plus a rate limit is a bound on abuse; a signature is a
  boundary. EXPOSURE **E-7**.
- **Log the sidecar's 401s.** A brute-force attempt and a misconfigured deploy are
  still indistinguishable, which is to say invisible. EXPOSURE **E-12**,
  A09:2025.
- **Remove the inert `revalidate`** from `/api/radio`, `/api/artist` and
  `/api/lyrics`. They read their query strings so they cannot be static; the
  export promises a cache they do not have. EXPOSURE **E-6**.
- **E-4**, the per-instance limiters, remains a knowing design trade rather than a
  defect. Revisit only if traffic makes it real.

## Third pass, 2026-09-11

**Updated 2026-09-11, against `6f3b6ae`, and 2026-09-12, against `45649bc`.** The pass
itself was a report; the fixes landed the same day and the next.

- **Fixed:** S-9 (`b18028f`, `1e9a114`), S-11 (`79940b9`), S-12 (`5c56e98`), S-14 (`173feae`), S-15 (`79940b9`,
  `b18028f`), S-16 (`d57c4a6`) and S-17 (`d57c4a6`, `18583c7`). Both "verified correct"
  rows the pass marked stale hold again.
- **Partly fixed**, and what is left of each:
  - **S-10** (`b18028f`, `45649bc`) — the pages are cached and metered and the artist
    page's search runs in the browser, but a failed Deezer lookup can be cached like an
    answer, because `lib/deezer.ts` cannot tell "not found" from "failed".
  - **S-13** (`d00121a`) — `RELEASE_TOKEN` should be a fine-grained token scoped to this
    repository: a GitHub setting only the owner can change.
  - **S-18** (`173feae`, `c124f7c`) — a short secret only warns at boot, on purpose,
    because the deployed secret's length could not be verified.
  - **S-19** (`5c56e98`, `d00121a`) — the `.env` leftovers cannot be confirmed from a
    commit.
- **Open from before:** E-14. The CSP is still `Report-Only` (`apps/web/next.config.ts:70`).
  The first sweep found `frame-src` missing `widget.deezer.com` and
  `embed.music.apple.com`, so enforcing would have broken Play on Deezer and Apple
  Music. Both are listed now (`6f3b6ae`, `next.config.ts:49`). The policy stays
  `Report-Only` because that sweep could not exercise YouTube, SoundCloud or Mixcloud
  playback from the network it ran on. The art proxy's `u` is still unsigned, and the
  sidecar still logs no 401s.

What is left, in order of consequence over effort:

1. **E-14** — sweep a page that plays from YouTube, SoundCloud and Mixcloud, from a
   network where they play, then flip the CSP to enforcing. It has only grown in value,
   because the page now also loads the Spotify Web Playback SDK. Note what it can and
   cannot do: the player scripts it allows run *in* the page, so it narrows where a
   stolen token can be sent (`connect-src https:` is wide — tighten that too), not
   whether those vendors' scripts can read it.
2. **S-10** — move the artist page's song list to `/api/search` in the browser, and let
   the album and collection pages tell a failed lookup from a missing one.
3. **S-9** — give the Spotify callers the same wait bound.
4. **S-13** — scope `RELEASE_TOKEN` to this repository.
5. Everything else — the S-18 refusal and `uv` hash, the S-19 `.env` leftovers — is
   hardening, best done when the files are open for another reason.

## Fourth pass, 2026-09-13

**Against `dcec2f4` (local `main`, 0.15.0), covering the thirty commits since the third
pass's `45649bc`.** Most are UI; two touched a trust boundary, and both were read.

- **New: S-20**, the artwork proxy admitting two API hosts — found by auditing `7f4bd46`,
  which widened the allowlist after the third pass had read it. `FIXED` here.
- **E-14 is closed. The CSP is enforcing** (`apps/web/next.config.ts`). It was the first
  item on the third pass's list and three weeks overdue then, blocked on a browser sweep
  from a network where YouTube, SoundCloud and Mixcloud play. What made it shippable
  without one: every origin the **top document** loads a script from or frames was
  enumerated from the code — the five `API_SRC`/`SDK_SRC` constants in `app/player/*` and
  the four `<iframe>` sites — and every one was already in the policy. What happens inside
  those iframes is a separate browsing context this policy does not govern, which is what
  made the sweep less load-bearing than it looked. `widget.sndcdn.com` and
  `api-widget.soundcloud.com` were added to `script-src` on the evidence of `layout.tsx`'s
  preconnects. The directives whose breakage static reading **cannot** predict —
  `connect-src`, `img-src`, `media-src` — were deliberately left wide rather than tightened
  in the same change.
- **Violations are now visible.** `POST /api/csp-report` logs a `csp_violation` line, with
  `report-uri` and `report-to` both pointing at it and a `Reporting-Endpoints` header
  declaring the group. It is rate-limited on its own 20/min budget, caps the body at 8 KB,
  reads only known keys, truncates each to 300 characters and echoes nothing. This is what
  turns the next narrowing into a measurement rather than a guess.
- **E-12 is closed.** The sidecar logs its 401s with method, path and peer — and never the
  value presented, because a near miss is still a credential. Both halves are asserted.
- **The rate-limit key no longer trusts the caller.** `clientKey` reads
  `x-vercel-forwarded-for` and then `x-real-ip` before falling back to `x-forwarded-for`.
  Vercel was never exposed — it overwrites XFF — but this repo ships a Dockerfile, and
  behind any front end that does not overwrite, a rotating header gave every request its
  own bucket and the limiter stopped existing. EXPOSURE called this conditional on the
  deployment; it is no longer conditional for anything that sets a header it owns.
- **CI audits both runtimes.** `pnpm audit --prod --audit-level high` now runs beside the
  sidecar's `pip-audit`, which had been the only dependency gate in the repository.
- **A claim above went stale, and is corrected here.** "There is not a single `postMessage`
  listener in the codebase" no longer holds: `use-tab-sync.ts:176` listens on a
  BroadcastChannel, and `mixcloud-player.tsx:76-92` briefly patches
  `window.addEventListener` to capture the `message` listeners Mixcloud's SDK registers so
  it can remove them on unmount. Neither is a cross-origin sink — a BroadcastChannel is
  same-origin, and `parseMessage` validates every field, including running `usableSongs`
  over a handoff queue before adopting it — so the **conclusion** stands. It should be
  stated about those two, not about their absence.

**Verified unchanged:** sidecar auth (constant-time, non-short-circuiting, refused before
the body is read), `/api/resolve` (every provider validates before it fetches; the sidecar
reduces a URL to an 11-character id), CSV formula injection (already defused,
`playlists/csv.ts:12`), the PKCE `state` check before the code exchange, Spotify tokens
(never logged, never in a URL, `Authorization` headers only), both Dockerfiles (digest-pinned,
non-root, `--require-hashes`), `.dockerignore` covering `.env*`, SHA-pinned Actions with
`persist-credentials: false`, and `UPSTREAM_TABLE` pinned to a commit rather than a branch.
`.env` has never been committed — checked with `--diff-filter=A` over all refs.

**Still open:** E-7, narrowed by S-20 but not closed. S-10's Deezer "not found" versus
"failed". S-13's `RELEASE_TOKEN` scope. S-18's boot refusal. On the CSP, the next step is
`connect-src`, which now has reports behind it. **S-19's `.env` leftovers are closed** —
read, found dead, and removed in place the same day; what remains under that entry is
rotating the one live secret.

**Sequenced behind another session, not overlooked.** S-10's remaining half lives in
`apps/web/lib/deezer.ts` and `packages/providers/src/deezer.ts`. A parallel session held
both for most of this pass with an `Accept-Language` fix — Deezer localises artist and genre
names to the country it geolocates the request IP to, which also broke `merge.ts`, whose
cross-provider dedupe keys on the artist name. They have since moved it to branch
`fix/deezer-locale` and returned the files. S-10 is queued behind that branch landing rather
than taken now, because its fix sits in the same function as their hunk: `deezer()` returns
`null` for both "no such artist" and "the request failed", and `lib/api.ts` caches the
second as though it were the first. Whichever lands second takes the conflict, and theirs is
already written.

## Fifth pass, 2026-09-13

**Against `addfdc9` (local `main`), on branch `security/live-cover-hosts`, unpushed.** The
fourth pass read the thirty commits since the third; this one re-read the parts no pass had
opened — both provider packages end to end, the storage and import paths, the sidecar's four
routes, and the scripts.

- **New: S-21**, live search results carrying covers on unvetted hosts. This is the one worth
  reading: S-20 tightened what `/api/art` accepts a week earlier, and the leak was on the
  other side of it — a URL that never reaches the route cannot be refused by it. The reason no
  earlier pass saw it is recorded in the entry: every sanitiser in this codebase sits on the
  **storage** path, and a search result is not stored. Confirmed against the live Audius API
  rather than argued from the code.
- **New: S-22, S-23**, the two mechanisms that carried it — four `<img src>` set without
  `proxied()`, and two stores validating covers more loosely than playlists do. `FIXED` except
  Mixcloud's and Spotify's players, which another session held.
- **New: S-24**, the sidecar's 30s upstream timeout behind a 6s caller deadline, in a 40-slot
  thread pool, with `/health` inside the same pool. `FIXED`; `_mobile_lock` left alone.
- **New: S-25** (Lucene backslash, `URIError` on a percent) `FIXED`, **S-26** (no upstream
  size cap) `OPEN`.

**Verified correct, this pass:** `core/limiter.ts` (token bucket, refunds on abort, per-key
serialised), `host-pool.ts`, `image-resize.ts` (25 MB before decode, 5 MB animated), the CSV
defusing again, `play-log.ts`'s `Object.hasOwn` guards against prototype pollution, every
player's iframe URL (`encodeURIComponent` onto a fixed base), `free-port.mts` and
`check-staged-imports.mts` (`execFileSync` with argument arrays, no shell), the sidecar's
pydantic bounds and `normalize.py`, and `spotify-web.ts`'s bundle-origin pin. The sidecar's
auth boundary was checked against the running service, not only read: all five POST routes 401
without the secret and with a wrong one, `/health` 200.

**A claim above is stale.** The table says `/docs`, `/redoc` and `/openapi.json` 404. Since
S-14 put the middleware in front of every path but `/health` they answer **401**. No
consequence — neither reveals more than the other — but the table should say 401.

**Still open:** S-26. E-7, unchanged by this pass. S-10, S-13, S-18.

**A finding of this pass expired while it was being written.** It read the five dead keys out
of `.env` and offered to close S-19 by inspection. Between that reading and this commit the
owner deleted them in place, which S-19 now records — so the item was closed by the fix, not
by the inspection, and the sentence claiming they are "still in `.env`" was wrong by the time
it would have been published. Rebasing onto `main` is what surfaced it. In a tree several
sessions write to, a statement about an untracked file is only true for as long as it takes
to write it down.

## Sources

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — the edition used for the
  mapping above; note A02 is now Security Misconfiguration and A03 is Software
  Supply Chain Failures, both of which moved since 2021
- [OWASP Top 10 project](https://owasp.org/www-project-top-ten/)
- [OWASP vulnerability index](https://owasp.org/www-community/vulnerabilities/)
