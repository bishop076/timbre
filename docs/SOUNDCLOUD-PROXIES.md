# SoundCloud catalogue search: who runs an api-v2 proxy

Measured 2026-08-20. `docs/BLOCKED.md` explains why SoundCloud search is off by default and
why `SOUNDCLOUD_API_BASE` exists; this is the survey of what you can actually point it at.

## What Timbre needs

`packages/providers/src/soundcloud.ts` calls `{base}/search/tracks?q=…&limit=…` and expects
`api-v2.soundcloud.com`'s own JSON shape — `collection[]`, each entry with `id`, `title`,
`duration`, `permalink_url`, `user.username`, `publisher_metadata.isrc`. So the base must be
a **reverse proxy that speaks api-v2 and supplies the `client_id` itself**. A proxy wanting
*your* credentials is no use: the credentials are the thing that is gated.

## Only one project implements that shape

**[soundcloak](https://github.com/maid-zone/soundcloak)** (AGPL-3.0, Go, mirrored from
`git.maid.zone`). Its `docs/API.md` documents `/_/api/v2/…` as a proxy for
`api-v2.soundcloud.com` that "automatically adds latest `client_id` value to your requests".
GET only; headers and body are ignored; the allowlist covers `/resolve`, `/charts/selections`,
`/mixed-selections`, `/users/…`, `/tracks/…`, **`/search/…`**, `/playlists/…` and
`/featured_tracks/…`. Gated behind `EnableAPI`, which is **off by default**, and
`/_/info` reports whether an instance has it on.

Everything else found is a different shape and would need its own provider, not this variable:

| Project | Why not |
|---|---|
| [voronianski/soundcloud-api-proxy](https://github.com/voronianski/soundcloud-api-proxy) | Proxies with *your* client secret. Last touched 2024, 2 stars. |
| [chriszhangusc/soundcloud-api-proxy](https://github.com/chriszhangusc/soundcloud-api-proxy) | Same, 2023. |
| [zackradisic/soundcloud-api](https://github.com/zackradisic/soundcloud-api) | A Go *library* that scrapes a `client_id`. A base to build a proxy on, not one to run. |
| 4get | Metasearch with a SoundCloud scraper, but its own JSON. A separate provider, not this base. |

## Instances, all tested against the exact call Timbre makes

Ten listed at [maid.zone/soundcloak/instances.html](https://maid.zone/soundcloak/instances.html).
Each was asked `/_/info` for `EnableAPI`, then
`/_/api/v2/search/tracks?q=daft+punk&limit=3`, then driven through Timbre's own provider —
four queries, 20 results each, so parsing is exercised and not just reachability.

| Instance | `EnableAPI` | Search | Tracks | 30s-gated | ISRC | Latency |
|---|---|---|---|---|---|---|
| `soundcloak.tijn.dev` (DE) | yes | **200** | 80 | **4%** | 28 | **681 ms** |
| `sc.monochrome.tf` (global) | yes | **200** | 80 | 8% | 28 | 797 ms |
| `sc1.maid.zone` (DE) | yes | **200** | 79 | 18% | 24 | 789 ms |
| `sc3.maid.zone` (US) | yes | **200** | 79 | 18% | 24 | 993 ms |
| `sc2.maid.zone` (JP) | yes | **200** | 80 | 15% | 22 | 1672 ms |
| `sc.opnxng.com` (SG) | no | 404 | — | — | — | — |
| `soundcloak.thoughtcrime.st` (US) | no | 404 | — | — | — | — |
| `soundcloak.nadeko.net` (US) | no | 404 | — | — | — | — |
| `sc.bloat.cat` (DE) | — | 200 but not JSON | — | — | — | — |
| `sc2.bloat.cat` (DE) | — | 301 | — | — | — | — |

Zero failures across 320 parsed tracks on the five that work. Set it as, for example:

```
SOUNDCLOUD_API_BASE=https://soundcloak.tijn.dev/_/api/v2
```

## Is it maintained?

Re-checked 2026-08-20.

| | Latest commit | Signals |
|---|---|---|
| soundcloak (upstream `git.maid.zone`, HEAD `d51e7c7`) | **2026-05-30** | One maintainer, AGPL-3.0, 22 stars, 6 forks, 1 open issue, first commit 2024-08. Quiet for ~12 weeks, not abandoned. |
| `tijnjh/sc.tijn.dev` (the fork behind `soundcloak.tijn.dev`) | 2026-06-18 | 21 ahead, 0 behind. |
| [SearXNG](https://github.com/searxng/searxng) | **2026-08-19** | 35.7k stars, AGPL-3.0, active daily. |

**The GitHub repo is a mirror and it lags.** The instances report commit `196746f`, which
returns *404 from the GitHub API* — it exists only upstream, as a mirror-sync merge. Judge
freshness at `git.maid.zone`, never at GitHub.

**SearXNG is far better maintained and still cannot be used as this variable.** Its
`searx/engines/soundcloud.py` scrapes and caches a guest `client_id` and queries
`api-v2.soundcloud.com/search` — the same technique — but returns SearXNG's own JSON, so it
needs a *provider*, not a base URL. Worse for this purpose, public instances refuse the JSON
API outright: of six of the fastest on searx.space, four answered `429`, one `403` and one
served HTML. Viable self-hosted only. A Codeberg sweep found nothing else of this shape;
`Tubular/NewPipeExtractor` is active but a Java library, and `saxist` needs your own OAuth.

## Is it safe?

**The software, read rather than assumed.** In `lib/api/init.go` the destination is
hardcoded — `SetScheme("https")`, `SetHost("api-v2.soundcloud.com")` — so it cannot be
turned into an open proxy, and the path must clear the allowlist before anything is sent.
It calls `req.Header.Reset()` and `req.ResetBody()`, so **headers and body you send are
discarded rather than forwarded**; only the method, path and query survive. GET only.

**The fork is cosmetic.** `tijnjh/sc.tijn.dev` differs from upstream in six files: README, a
JPEG of a cat with a boombox, one CSS file and two templates. `lib/api/init.go` is
byte-identical. No Go code changed — no logging, no rewriting, no extra hop.

**Measured on the live instances:**

- TLS verifies on all five (Let's Encrypt, or Google Trust for `sc.monochrome.tf`), no
  redirects, and **not one `Set-Cookie`**. All send `Referrer-Policy: no-referrer`.
- **No tampering.** Resolving the same track on every instance returns an identical `id`,
  `title`, `isrc` and the same 47 fields — no injected keys — and the title and artist match
  `soundcloud.com/oembed`, which is an independent source needing no proxy.
- **None publishes a privacy policy.** `/privacy` answers `200` on all of them, which is a
  false positive: soundcloak reads the path as a *SoundCloud username* and renders the
  profile of a user called "privacy" (36 followers). There is no stated logging or retention
  anywhere. Every query, and your listeners' taste, is visible to whoever runs the box.
- `sc.monochrome.tf` sits behind **Cloudflare**, so that traffic is visible to Cloudflare too.
- `soundcloak.tijn.dev` throttles bursts — it returned `429` during a five-instance sweep,
  then answered eight sequential requests without complaint. Timbre has no cache in front of
  this and soundcloak's own docs say the proxy does not cache, so a busy deployment will meet
  that limit.

**The thing that actually decides which to use is duration — but not for the reason first
given here.** `sc.monochrome.tf` returns Ed Sheeran's *Shape of You* as `233759` ms; both
maid.zone instances return `30000`.

> **Correction, 2026-08-20.** This section originally attributed that to
> `UseTokensInAPI` attaching the operator's SoundCloud account. **That was wrong**, and the
> measurement that refutes it is one line of the same table: `soundcloak.tijn.dev` returns
> the full duration too, and it is neither the Cloudflare instance nor a plausible
> account-carrying one — it is the *fastest and least gated* of the five. Asking every
> instance for the same track id, within one minute:
>
> | route | policy | duration | `snipped` |
> |---|---|---|---|
> | direct api-v2, fresh anonymous id | `MONETIZE` | 233759 | false |
> | `sc.monochrome.tf` | `MONETIZE` | 233759 | false |
> | `soundcloak.tijn.dev` | `MONETIZE` | 233759 | false |
> | `sc1.maid.zone` | `SNIP` | 30000 | true |
> | `sc3.maid.zone` | `SNIP` | 30000 | true |
>
> **A fresh anonymous `client_id`, with no account of any kind, returns the full duration.**
> So a token is not what lifts the gate; the gate is not there when the credential is fresh.
> `/_/info` does not expose `UseTokensInAPI` at all, so the original claim was inference from
> a setting that cannot be observed from outside. The explanation that fits every row is
> simpler: **the maid.zone instances are serving a stale or degraded `client_id`.**

Since `aa5a5ca` drops `policy: "SNIP"` rows rather than listing them, that rate is no longer
a measure of bad rows — it is a measure of **catalogue silently thrown away**: 15–18% on
`sc1`/`sc3`, 8% on `sc.monochrome.tf`, 4% on `soundcloak.tijn.dev`, 3% direct. Choosing a
maid.zone instance now costs about one result in six, with no error and nothing in a log.

That failure is invisible by construction — a degraded credential answers `200`, so nothing
retries and nothing warns. The cheap detection is one request per credential: ask api-v2 for
a known `AD_SUPPORTED` track and look at `policy`; `SNIP` means the credential is the
degraded kind. Not built yet.

## If you are serverless and free, run neither

Everything above assumes somewhere to put a long-lived Go process. Timbre is built to deploy
serverless and free, and that is precisely where soundcloak does not fit:

- **Cloud Run / Fly / Koyeb scale-to-zero** — the free tiers want a billing account, and the
  cold start costs about **five seconds**, because `lib/sc/init.go` resolves the `client_id`
  at boot. Measured 2026-08-20: 1.9s for soundcloud.com, 3.2s for the asset bundle holding it.
- **Card-free container hosts** (Render's free tier) spin down after idling and take tens of
  seconds to come back, *before* those five.
- **Pinning `CLIENT_ID`** avoids the boot fetch, and the refresh ticker sits in the `else`
  branch of `if cfg.ClientID != ""`, so a pinned id **never refreshes** and everything breaks
  silently when SoundCloud rotates it.
- Worse, an unpinned instance that fails the scrape calls `os.Exit(1)`. On a serverless host
  that is a failed cold start rather than a degraded one.

So for that deployment the answer is `SOUNDCLOUD_DIRECT_API=true`, which does the same
`client_id` resolve inside Timbre — once per instance, cached four hours, on a 2.5s deadline
so the first search of a cold instance abstains rather than making everyone wait. Measured:
the cold search returned 0 SoundCloud results and the next returned 29. No second service, no
second account, nothing to keep warm.

It is the same bargain, not a smaller one: see `docs/BLOCKED.md` for what turning it on means.
