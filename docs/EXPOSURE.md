# Exposure

What a **public** deployment of Timbre exposes, and what it spends.

`docs/BUGS.md` logs defects. `docs/BLOCKED.md` logs other people's gates. This
logs the things that are working exactly as written and are still a liability
once the app is reachable from the open internet — limits that do not hold at
the scale they were sized for, routes that cost more than they look like they
cost, and assumptions that were true on a laptop and are not true on Vercel.

*Compiled 2026-08-18, against `57e266c`; fixes recorded through `5e0d710`. Nothing
here is theoretical unless it says so.*

## How to read an entry

Every claim carries the evidence class it came from:

| | |
|---|---|
| **`read`** | Verified in this repository, file and line named. |
| **`vendor`** | Verified against the vendor's own current documentation, linked at the end. |
| **`unmeasured`** | Reasoned, not observed. Says how to measure it. |

Severity is about *this* deployment — no accounts, no database, no money moving
— not about what the same finding would mean in an app that had those.

Status: `OPEN` · `ACCEPTED` · `FIXED` · `NOT-A-PROBLEM`

---

# Part 1 · The platform

## E-1 · Hobby is non-commercial personal use only, and donations count `OPEN`

**Severity:** high — this is the one that can take the whole deployment down at
once, with no warning and no technical symptom beforehand.

**`vendor`.** Vercel's Fair Use Guidelines, verbatim:

> **Hobby teams** are restricted to non-commercial personal use only. All
> commercial usage of the platform requires either a Pro or Enterprise plan.
>
> Commercial usage is defined as any Deployment that is used for the purpose of
> financial gain of **anyone** involved in **any part of the production** of the
> project […]
>
> Asking for Donations fall under commercial usage.

The listed examples include advertising, affiliate linking as the primary
purpose, and "receiving payment to create, update, or host the site".

**What this rules out**, as long as Timbre is on Hobby: a Ko-fi link, a
"support this project" button, a sponsor logo, any ad unit, and being paid by
anyone to run it. A GitHub Sponsors button on the *repository* is not a
Deployment and is outside this text — a donate link on the *site* is inside it.

**Unblocked by:** Pro, or not asking for money.

## E-2 · Vercel can terminate a Hobby project without notice `ACCEPTED`

**Severity:** medium. **`vendor`.** The Terms reserve the right to disable or
remove any Hobby deployment at Vercel's sole discretion, with or without notice.
The Fair Use page softens it — "where possible, we'll reach out before taking
action" — but the entitlement is one-sided.

**Accepted, because the mitigation already exists.** Nothing in either app
imports a platform SDK, `apps/ytmusic/Dockerfile` is built by CI on every
release, and the web app is stock Next. Recovery is a redeploy elsewhere, not a
rewrite. That is worth keeping true; see `docs/DEPLOY.md`.

**What is not mitigated:** the URL. Anyone who bookmarked
`<project>.vercel.app` loses it. A custom domain would make the host portable,
and costs money, which is the trade.

## E-3 · There is no stable outbound IP on Hobby `OPEN`

**Severity:** medium, and it is the root of E-4.

**`vendor`.** Static outbound IPs are a Pro/Enterprise feature, and even there
they are a *shared pool* inside a Vercel-managed VPC; full network isolation is
Secure Compute, which is Enterprise. On Hobby you get neither. Outbound requests
leave from whatever address the platform happens to use, shared with other
customers, and it can change between invocations.

**Why it matters here.** Every upstream limit Timbre paces against is per-IP:
Apple's ~20 requests/minute, Deezer's ~50 per 5 seconds, and whatever
undocumented threshold YouTube applies. Timbre does not own the address those
limits are counted against, and does not get it to itself.

**Consequences, both directions:**

- Timbre can be throttled by upstream for traffic that was never Timbre's,
  because a stranger on the same egress address spent the budget.
- Timbre's own pacing state is meaningless across an address change — the token
  bucket keeps counting for an IP it is no longer using.

**`unmeasured`:** how often the address actually changes, and whether Apple's
403s show up in practice. Measure by logging upstream status codes from the
limiter in `apps/web/lib/providers.ts` over a week of real traffic.

---

# Part 2 · Back-pressure that does not hold in serverless

## E-4 · All three limiters are per-instance and in memory `OPEN`

**Severity:** high. The most consequential engineering finding in this file, and
the only one that is a genuine *design* mismatch rather than a missing feature.

**`read`.** Timbre has three separate pieces of back-pressure. Every one of them
lives in the memory of a single process:

| Mechanism | Where | Scope as written |
|---|---|---|
| Outbound pacing (token buckets) | `apps/web/lib/providers.ts:62` — `new RateLimiter(new MemoryBucketStore())` | one process |
| Inbound rate limit, 60/min/client | `apps/web/lib/api.ts:53` → `lib/rate-limit.ts` | one process |
| Response cache, 2 min / 500 entries | `apps/web/lib/api.ts:46` → `lib/cache.ts` | one process |

`packages/core/src/limiter.ts` says of the store interface it defines:

> Persistence for buckets, so pacing survives restarts and spans processes.

and of the implementation actually deployed:

> **In-memory store. For tests and single-process development only.**

That comment is correct, and the deployment contradicts it.

**What serverless does to each.** Vercel runs as many concurrent instances as
demand requires. With *N* live instances:

- the inbound limit is not 60/min/client, it is up to **60 × N**, because a
  client's requests land on whichever instance is free;
- the response cache hit rate falls by roughly the same factor, so the calls it
  exists to prevent get made anyway;
- the outbound token bucket paces each instance to Apple's *entire* per-IP
  budget independently, so *N* instances can spend it *N* times over.

All three fail in the same direction — **looser than intended, never tighter** —
and the thing they were sized to protect is the tightest limit in the system and
belongs to somebody else.

**Mitigating fact, not a fix:** Fluid compute lets one instance serve many
concurrent requests, so *N* is smaller than a raw request count suggests, and a
warm instance keeps its maps. This narrows the gap. It does not close it, and it
is a platform behaviour rather than a property of the code.

**What would fix it:** shared state — the thing Timbre does not have, by design
and for good reasons. The honest options, cheapest first:

1. **Accept it and write it down.** These are accident-stoppers, not access
   control, and `rate-limit.ts` already says so in its header. This entry is
   that writing-down.
2. **Lean on the CDN instead of on memory.** See E-6: a correct `s-maxage` on a
   route absorbs repeat traffic before a function is ever invoked, which is both
   cheaper and genuinely shared. Highest-value change on this list.
3. **Add a shared store** (Vercel KV, Upstash) implementing `BucketStore`. The
   interface was designed for exactly this and nothing else would have to
   change — but it ends "no database", which is a real cost to a project whose
   whole pitch is that it has none.

## E-5 · The comment justifying per-instance pacing rests on a false premise `FIXED`

**Severity:** low as a defect, high as misinformation — it is the reason E-4
reads as settled.

**`read`.** `apps/web/lib/providers.ts:45-46`:

> In-memory permanently: Timbre runs no database, and per-instance pacing is the
> right scope when each instance has its own outbound IP and the limits are
> per-IP.

The conditional is doing all the work, and per E-3 it does not hold on Vercel
Hobby. Instances do not get their own outbound IP; they draw from a shared pool
they do not control.

**Fixed in `8f10eef`.** The comment now says what is actually true: this is a
knowing trade, not a matched scope. A wrong justification in code is worse than no
justification, because it stops the next reader from checking.

## E-6 · `export const revalidate` does nothing on a Route Handler `FIXED`

**Severity:** medium, and it silently removes a layer everyone assumes is there.

**`read`, from the Next.js docs shipped in this repo**
(`apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:51`):

> Route Handlers are not cached by default. You can, however, opt into caching
> for `GET` methods. […] To cache a `GET` method, use a route config option such
> as `export const dynamic = 'force-static'` in your Route Handler file.

Four routes export `revalidate`. None exports `force-static`:

| Route | Declares | Actually |
|---|---|---|
| `app/api/charts/route.ts:13` | `revalidate = 3600` | runs on every request |
| `app/api/radio/route.ts:10` | `revalidate = 3600` | runs on every request |
| `app/api/artist/route.ts:11` | `revalidate = 86_400` | runs on every request |
| `app/api/lyrics/route.ts:11` | `revalidate = 86_400` | runs on every request |

**They are not uncached** — each sets `cache-control: s-maxage=…` and Vercel's
CDN honours it. But the CDN cache key is the **full URL**, so any unrecognised
query string is a miss:

```
GET /api/charts?_=1   →  CDN miss  →  function runs  →  Deezer + Apple hit
GET /api/charts?_=2   →  CDN miss  →  function runs  →  Deezer + Apple hit
```

`/api/charts` takes no parameters at all, so every one of those is the same
answer fetched again. Behind the CDN, the only thing metering it is the
per-instance counter from E-4.

**Not affected:** `/explore`. It is a *page*, pages are cached by default, and
its `revalidate = 3600` is real — which is why the expensive genre fan-out is
safe and the cheap-looking chart route is not.

**Fixed in `8f10eef`** for `/api/charts`, the clear case — the build now reports it
as `○ … 1h` rather than dynamic. Getting there meant the handler taking no
`Request` at all, which is correct for a route rendered at build time: there is no
caller to meter and no connection to abort. Reading `request.signal` off the
build-time stub failed the build outright, which is how this was caught.

**Still open** for `/api/radio`, `/api/artist` and `/api/lyrics`. Those genuinely
read their query strings, so they cannot be static; they keep `s-maxage` and the
inert `revalidate` should simply be removed from them.

---

# Part 3 · The routes anyone can call

Every API route calls `guard(request)` except two.

## E-7 · `/api/art` is an unmetered image relay `FIXED`

**Severity:** high — the cheapest way to spend this deployment's allowances.

**`read`.** `apps/web/app/api/art/route.ts` never imports `guard`. It accepts
`?u=<url>` and will fetch and return anything that is HTTPS, on one of 13
allowlisted hosts, serving `content-type: image/*`, under 8 MB.

The allowlist is a good SSRF control and it is not a spending control. Those
hosts serve the whole of YouTube's, Deezer's and Apple's artwork at every size
they publish. A script that walks them pulls real bytes through Timbre's origin
on every request.

**What it spends** (`vendor`, Hobby monthly):

| Allowance | Ceiling | Notes |
|---|---|---|
| Fast Origin Transfer | **10 GB** | the binding one — every cache miss goes through origin |
| Fast Data Transfer | 100 GB | what leaves the CDN |
| Invocations | 1M | one per miss |

Repeat requests for the *same* URL are cheap: the response is
`public, max-age=31536000, immutable`, so the CDN answers. **Distinct** URLs are
not, and there are effectively unlimited distinct URLs. At the 8 MB ceiling,
about **1,300 requests exhaust the 10 GB of origin transfer**. At a realistic
50 KB per cover, about 200,000. Neither number is large.

**Why it was left open:** artwork is fetched by `<img>` tags during ordinary
rendering, and a 429 there means a broken image on a legitimate page. That is a
real concern, and it does not justify *nothing*.

**Fixed in `1e2e536`.** `guardArtwork()` — 300/min/client, on its own budget rather
than sharing the API's, because a page renders ~30 covers and a 429 on an `<img>`
is a broken picture rather than a retry.

**Not done, and worth doing:** signing the `u` parameter with the existing secret,
so only URLs Timbre itself produced are fetchable. That turns the allowlist into an
actual boundary rather than a bound on which hosts can be relayed.

## E-8 · `/api/art` follows redirects without re-checking the allowlist `FIXED`

**Severity:** medium, conditional on an open redirect existing upstream.

**`read`.** `route.ts:65-70` calls `fetch(target, …)` with no `redirect` option,
so the default `follow` applies. The allowlist and the `https:` check run
against the URL *supplied*, once, before the fetch — and never again against
wherever the redirect lands. If any of the 13 hosts can be made to redirect off
its own origin, the allowlist is advisory.

**What limits the damage:** the response must still be `image/*` and the body is
size-capped, so this is an egress path rather than a data-exfiltration one.

**Fixed in `1e2e536`.** `redirect: "manual"`, re-validating `location` against the
same allowlist on every hop, three hops maximum. Moved to `lib/artwork-proxy.ts` to
be testable — nine tests against a real loopback server, since what is being tested
is how the runtime reports a redirect and a stub would only assert what I already
believed.

## E-9 · A declared `content-length` under the cap is trusted `FIXED`

**Severity:** low.

**`read`.** `route.ts:89-90`: when `content-length` is present and positive, the
body streams straight through and the metering `TransformStream` is skipped. A
response declaring 100 bytes and sending far more is not caught by Timbre.

In practice the HTTP client errors on a length mismatch, which is why this is
low rather than medium. It is still a case of the cap being enforced by whoever
answered rather than by the code whose job it is.

**Fixed in `1e2e536`.** Always wrapped in `capped()`; the header check stays as the
early-out it should always have been.

## E-10 · `/api/health` is unguarded and doubles every hit `FIXED`

**Severity:** low.

**`read`.** `app/api/health/route.ts` is `force-dynamic`, calls no `guard`, and
fetches the sidecar's `/health` on every request with a 2-second timeout. One
inbound request is therefore **two invocations** — one web, one sidecar — plus a
round trip. It is the cheapest way to consume the invocation allowance, and it
returns nothing an attacker wants.

**Deliberately open** so uptime monitoring works without a credential, which is
the right call. Rate-limit it well above a monitor's interval rather than
closing it.

**Fixed 2026-08-21, exactly as that says.** The route stays open and now goes
through `guardHealth` — 30/minute/client, a probe every two seconds, far above any
monitor's interval and far below a loop.

Its **own** budget rather than `guard`'s, for the reason artwork has one: a
monitor and a reader routinely share an address behind NAT, and a probe refused
because somebody searched a lot reads as an outage — which is the one thing a
liveness endpoint must never invent.

---

# Part 4 · The sidecar

## E-11 · The shared secret has no rotation path `FIXED`

**Severity:** medium.

**`read`.** `YTMUSIC_SHARED_SECRET` is a static string, compared with
`hmac.compare_digest` (`apps/ytmusic/app/security.py:20` — correct; see
*Verified correct* below). It never expires, is not versioned, and lives in two
projects' environment variables.

**The problem is the changeover.** The two projects deploy independently, so
during a rotation one side holds the new value and the other the old, and every
search returns 401 until both settle. There is no documented procedure and no
support for two valid secrets at once, which means rotation is an outage — so in
practice it will not happen, which is how a static secret becomes a permanent
one.

**Fixed in `2598c93`.** `config.py` accepts a comma-separated list. The web app
still sends exactly one, so the sequence has no gap: add the new secret alongside
the old on the sidecar, move the web app across, drop the old.

`matches()` accumulates rather than short-circuiting — `any()` stops at the first
hit, so the time taken would report *which* secret matched, and mid-rotation that
distinguishes a caller still on the old one.

## E-12 · The secret is the sidecar's only defence `ACCEPTED`

**Severity:** low as written; high if the secret ever leaks.

**`read`.** `apps/ytmusic/app/main.py:44-55` attaches `require_shared_secret` to
both routers, and there is nothing behind it — no rate limit, no per-caller
accounting, no logging of repeated failures. Anyone holding the secret has the
access the web app has, indefinitely and silently.

**Accepted** because the blast radius is genuinely small: the service holds no
credentials, no user data and no database connection, and `config.py` says so
accurately. What a leak costs is E-3 and E-4 — somebody else's searches spending
this deployment's CPU and this deployment's standing with YouTube.

**Worth doing anyway:** log 401s with the calling address. Right now a
brute-force attempt and a misconfigured deploy look identical, which is to say
invisible.

## E-13 · The loopback default is load-bearing only on the container path `NOT-A-PROBLEM`

**`read`.** `config.py:31` binds `127.0.0.1` unless `YTMUSIC_HOST` says
otherwise, so exposing the service is a deliberate act. On Vercel the value is
unused — the platform owns the socket. It matters if the Dockerfile escape hatch
in `docs/DEPLOY.md` is ever taken. Recorded so nobody "cleans it up".

---

# Part 5 · The browser

## E-14 · No security response headers at all `PARTLY FIXED`

**Severity:** medium.

**`read`.** `apps/web/next.config.ts:34-44` sets exactly two headers, both about
caching `/profile`. There is no middleware. Absent, therefore:

| Header | What its absence allows |
|---|---|
| `Content-Security-Policy` | nothing constrains what an injected script could load or reach |
| `X-Frame-Options` / `frame-ancestors` | any site can frame Timbre and clickjack it — deleting a playlist is one click |
| `Strict-Transport-Security` | the first request of a session can be plain HTTP |
| `Referrer-Policy` | full URLs leak to every third party the page touches |
| `Permissions-Policy` | nothing declines camera, microphone or geolocation on Timbre's behalf |

The last three are one-liners in `next.config.ts` with no design cost.

**Fixed in `8f10eef`,** except for the CSP — the five headers above ship enforced
on every response. Clickjacking is covered today by `X-Frame-Options: DENY`, and
does not wait on anything below.

**CSP ships `Report-Only`, and that is a real limitation rather than caution.**

I claimed here that a build-time script hash was "the answer that works," on the
grounds that the boot script is a module constant with a stable SHA-256. **That is
wrong, and reading the CSP guide shipped in `node_modules/next` is what showed
it.** The boot script is not the only inline script on the page: Next inlines its
own bootstrap and streams its flight payload as `<script>` tags whose contents
differ per page and per render. No fixed set of hashes in `next.config.ts` can
cover those, and `strict-dynamic` does not help, because they are in the HTML
rather than loaded by an already-trusted script.

The documented answer is a per-request nonce, and the same guide is explicit:

> Every time a page is viewed, a fresh nonce should be generated. This means that
> you **must use dynamic rendering to add nonces**.

Dynamic rendering is exactly what this deployment cannot afford — it is the
prerendering that keeps Explore at one upstream fan-out an hour and the whole
thing inside the free tier. So `script-src` keeps `'unsafe-inline'`, and what the
policy actually buys is the other directives: `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, and a
`script-src` that still refuses any *origin* not named.

`Report-Only` because the remaining risk is a wrong `frame-src` or `connect-src`
breaking playback silently, and that cannot be verified without a browser. **To
finish this:** open the console on a page that plays something, a page with an
avatar, and Explore. If nothing is reported, rename the header key in
`next.config.ts` to `Content-Security-Policy`.

### Re-rated 2026-08-21: `medium` → `high`, because Spotify changed what an XSS wins

Everything above still holds — the nonce argument, the prerendering cost, the
reason `Report-Only` was the honest setting. **What changed is the other side of
the trade, and the entry was scored before it changed.**

When this was written the browser held playlists, a display name and a theme. A
successful XSS could deface a page and read a stranger's music taste. Since
`a73395e` it also holds a **Spotify refresh token** in `localStorage`
(`app/spotify/token-store.ts`) — a long-lived credential to a third party's
account, carrying `streaming` and `user-modify-playback-state`.

So the policy that ships is `'unsafe-inline'` **and** unenforced: neither half of
the defence is active, against a browser that now stores something worth taking.
Confirmed on the live deployment 2026-08-21 — `Content-Security-Policy-Report-Only`
is the only CSP header present; `X-Frame-Options`, HSTS, `nosniff`,
`Referrer-Policy` and `Permissions-Policy` are all enforced.

This is **not** a claim that an XSS exists. S-7's neighbours in
[SECURITY.md](SECURITY.md) — one interpolation-free `dangerouslySetInnerHTML`, no
`postMessage` listeners, no `innerHTML`, no `eval` — say the surface is genuinely
clean, and that has been checked twice. It is a claim that the *consequence* of
one moved, and that the ten minutes of browser work this entry already prescribes
is now worth more than it was. **Do that before adding any further credential to
the browser**, which is the decision this rating exists to inform.

`frame-src` permits `www.youtube.com` and `w.soundcloud.com`, which is the point
of the app rather than a weakening of the policy — they are the only two external
origins in the codebase.

## E-15 · The `timbre-name` cookie is not `Secure` `FIXED`

**Severity:** low.

**Fixed in `5e0d710`.** `apps/web/app/profile/local-profile.ts` wrote the cookie
with `path=/`, `max-age` and `SameSite=Lax` — and no `Secure`, so it would travel
over plain HTTP and could be set by a non-secure origin on the same host. Local
development is unaffected: browsers treat `localhost` and `127.0.0.1` as secure
contexts, so the cookie is still set there over http.

It carries a display name the user typed and nothing else, control characters
are stripped at the single choke point (`setDisplayName`), and React escapes it
on the way out — so the value is not dangerous. `Secure` is still free.

`path=/` also means it rides along on every request to the origin, including
each `/api/art` fetch. Small, but it is bytes on the hot path, and the comment
directly above it already reasons carefully about exactly this cost for
thumbnails.

---

# Part 6 · Upstream, and the law

## E-16 · A public deployment is a different argument from personal use `OPEN`

**Severity:** unquantifiable, which is why it is here rather than assumed away.

Timbre's design deliberately respects the constraints its README names: audio
always plays through the owning service's official player; streams are never
extracted (`routes/search.py:187-189` reads `videoDetails` and pointedly ignores
`streamingData`); nothing is cached or downloaded; no Spotify content is touched.
That is a stronger position than most projects in this space and worth keeping.

**What changes when it goes public:** the searches stop being one person's and
become a service's. `ytmusicapi` reaches YouTube's private web-client API rather
than a documented public one, and YouTube's terms address automated access to
the service regardless of who benefits. Running it for yourself and operating it
for strangers are different facts, whatever one thinks of the rule.

This is not legal advice and this file cannot give any. It is a flag that the
question exists, is different from the one the README answers, and should be
answered deliberately rather than by default.

## E-17 · Whether YouTube serves search from a datacenter IP `MEASURED — it does`

**Settled 2026-08-21, on the first real deployment.** The `POST /search` call
below, run against the live sidecar on Vercel with the shared secret, returned
results:

```
As It Was (Official Video) · H5v3kku4y6Q · MUSIC_VIDEO_TYPE_OMV
```

That is the exact fixture `RUNNING.md` names for a healthy local run —
`_OMV` rather than an `_ATV` art track, so the ranking in `BUGS.md` B-2/B-3 holds
from a datacenter address too. End to end through the web app, `/api/search`
answered **200 in 2.77s** with five sources attempted and zero failures, which
also lands inside `DEPLOY.md`'s predicted ~3.3s cold warm-up for `ytmusicapi`.

**The reasoning was right.** The blocking that killed Invidious is on *video
delivery*, which Timbre never performs; search is a lighter path and it is served.

The caveat below survives the measurement and is now the whole of this entry:

> Note the interaction with E-3: the answer is a property of the address Vercel
> happened to use, not a permanent one. It can change without any deploy.

One address, one day. If search goes quiet across the board later, re-run the same
call before assuming anything in this repository broke.

*Original entry, kept because the method is what settled it:*

**`unmeasured`, and it is the single fact the entire deployment rests on.**

The reasoning in `docs/DEPLOY.md` is sound — the blocking that killed Invidious
is on *video delivery*, which Timbre never performs, and search is a lighter
path. Reasoning is not a measurement, and the general picture that datacenter
ranges are heavily bot-flagged is well attested.

**How to settle it:** the `POST /search` call in `docs/DEPLOY.md`, run against
the deployed sidecar. Results means it works; 403s means stop and read
`docs/BLOCKED.md`. Do this **before** anything else on this list — most of the
rest is moot if it fails.

Note the interaction with E-3: the answer is a property of the address Vercel
happened to use, not a permanent one. It can change without any deploy.

## E-18 · Every reader's lyrics lookup arrives at LRCLIB as one client `OPEN`

**Severity:** low, and deliberate.

**`read`.** `app/api/lyrics/route.ts:14` sends
`User-Agent: Timbre (https://github.com/bishop076/timbre)` on every call, which
is what LRCLIB asks of clients and the honest thing to do. It also means all
traffic is attributable to one identifiable project from one address, so abuse
of `/api/lyrics` — metered only by E-4's per-instance counter — gets *Timbre*
throttled, not the abuser.

It also permanently links the deployment to that GitHub account. Intended, but
worth stating plainly rather than discovering later.

---

# Verified correct — do not re-investigate

| Finding | Evidence |
|---|---|
| **No YouTube quota exists.** `apps/ytmusic/app/client.py:44` constructs `YTMusic()` with no credentials, and there is no YouTube Data API key anywhere in the repository. There is no quota to exhaust and no account to suspend. What is at risk is rate-limiting of the address and Vercel's allowances — not a Google quota. | `read` |
| **Constant-time secret comparison.** `security.py` uses `hmac.compare_digest`, and accumulates rather than short-circuits so a rotation cannot leak which secret matched. Correct — though reading it *for timing* is what let it raise on a non-ASCII header for a week. See [SECURITY.md](SECURITY.md) **S-7**, fixed 2026-08-21. | `read` |
| **`x-forwarded-for` handling is right on Vercel.** `lib/rate-limit.ts:84-88` takes the first entry, and Vercel's docs state: *"we currently overwrite the X-Forwarded-For header and do not forward external IPs. This restriction is in place to prevent IP spoofing."* So the first entry is the real client. **This becomes spoofable the moment Timbre runs anywhere else** — behind nginx, Caddy, or the Dockerfile — where the header is attacker-controlled and a rotating value defeats the limiter entirely. Conditional on the deployment, not on the code. | `vendor` + `read` |
| **The art proxy's SSRF control.** HTTPS-only, explicit 13-host allowlist, `image/*` enforced, `nosniff` set. Sound as far as it goes; E-8 is about the redirect hop, not this. | `read` |
| **No audio ever transits Timbre.** Every player is an embed. Bandwidth is HTML and JSON — which is what makes 100 GB a generous allowance rather than a day's traffic. | `read` |
| **The sidecar holds nothing at rest.** No credentials, no sessions, no database connection. Compromising it yields access, not data. | `read` |
| **Request bounds are enforced.** `models.py`: query ≤ 500 chars, `limit` 1–50, `video_id` regex-pinned, URL ≤ 2000. Nothing unbounded reaches upstream. | `read` |

---

# What to do first

**E-5 through E-11 and most of E-14 are fixed** — see each entry. **E-17 is
measured and settled**, on the deployment of 2026-08-21: YouTube does serve search
from a Vercel address. What is left, ordered by consequence over effort:

1. **E-1** — decide about donation and sponsor links *before* adding one. This is
   the one that can end the deployment with no technical warning, and it is now
   first because the question E-17 asked has an answer.
2. **E-14** — flip the CSP from `Report-Only` to enforcing, once a browser has
   confirmed it breaks nothing. Three pages to check, and it moved up: the browser
   now holds a Spotify refresh token, so an XSS wins a credential rather than a
   defacement. See the re-rating on that entry.
3. **E-7** — sign the `u` parameter, so the art proxy has a boundary rather than
   a bound. The rate limit stops the bleeding; this closes it.
4. **E-12** — log the sidecar's 401s, so a brute-force attempt stops looking
   exactly like a misconfigured deploy.
5. **E-6** — drop the inert `revalidate` from the three routes that cannot be
   static, so nothing advertises a cache it does not have.
6. **E-3 / E-4** — measure before acting. Log upstream status codes for a week;
   if Apple is not 403ing, the per-instance limiters are a trade worth keeping,
   and shared state is the thing this project is built to avoid.

---

## Sources

- [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- [Vercel Terms of Service](https://vercel.com/legal/terms)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel Static IPs](https://vercel.com/docs/networking/static-ips)
- [Vercel Secure Compute](https://vercel.com/docs/connectivity/secure-compute)
- [MDN — X-Forwarded-For](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For)
- Next.js Route Handler caching — the copy shipped in this repo, at
  `apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
