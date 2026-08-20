# Blocked

Things Timbre cannot do because someone else gates them. `docs/BUGS.md` logs
*our* defects; this logs *their* gates, so the two never get confused.
[SUGGESTIONS.md](SUGGESTIONS.md) logs things that **might** be true —
**every claim in this file is measured**, and anything merely read or reasoned
belongs there instead.

Each entry: what is blocked · what blocks it · what would unblock it · when it was
last checked.

Status: `BLOCKED` · `DECLINED` · `DEFERRED` · `REGRESSED` ·
`AVAILABLE (self-host only)`

---

## SoundCloud catalogue search `BLOCKED` — and why SoundCloud is not shipped

*Checked 2026-08-15.*

**Blocked by:** open registration closed years ago. Access is case-by-case via an
application form, requires a paid **Artist Pro** subscription, is manually
reviewed over weeks, and is not guaranteed.

**Not blocked:** playback. `soundcloud.com/oembed` and the HTML5 Widget API need
**no credentials at all**, and the whole integration is written and verified —
`packages/providers/src/soundcloud.ts`, `apps/web/app/player/soundcloud-player.tsx`,
`app/api/resolve/route.ts`. Position advances, duration reads, attribution is
correct.

**Why it is still unshipped.** Without search, the only way a track enters Timbre
is a user pasting a URL they already found on soundcloud.com. That is a SoundCloud
badge in the UI that almost nobody could ever trigger. **A source you cannot search
is not a source**, so it is registered nowhere and invisible to every code path:
`searchAll` skips it via `searchable: false`, and `resolveUrl` only walks
*registered* providers.

**Unblocked by:** approval. Then set `searchable: true` in `soundcloud.ts` and add
`registerProvider(createSoundCloudProvider())` in `apps/web/lib/providers.ts`.
**No other code changes** — `packages/providers/src/types.ts` was designed for a
provider that is playable but not searchable.

**Free to start now:** the application costs nothing to submit and the latency is
the whole problem, so filing it early is strictly better than filing it later.

### Update 2026-08-20 — the operator may now unblock it themselves

Two opt-in escape hatches exist, both **off in the hosted build and off for anyone who
clones this**. Neither changes what shipping means; they change who is allowed to decide.

`SOUNDCLOUD_API_BASE` points at an api-v2-shaped proxy the operator runs — a soundcloak
instance with `EnableAPI` — so the extraction happens in somebody else's codebase on their
own IP. That was the original hatch and it is still the cleaner one.

`SOUNDCLOUD_DIRECT_API` lets Timbre resolve a guest `client_id` from soundcloud.com and call
api-v2 itself. **This is the technique this document declined**, and naming it plainly
matters more than the reasoning: it is now present in the tree, behind a flag.

The reason it exists is that the first hatch is not reachable for the deployment Timbre is
built for. soundcloak is a long-lived Go process; a free serverless host has nowhere to put
one, scale-to-zero containers pay ~5s a cold start resolving the same `client_id`, and the
free tiers that would host it either want a billing account or spin down for ~30s. "Run your
own instance" is sound advice that costs money or a second provider account, and Timbre's
whole premise is that neither should be required.

What has *not* changed: it is off by default, `searchAll` still skips SoundCloud when it is
off, and playback still needs no credentials at all. What has changed is that an operator
who wants catalogue search can have it without renting a server — and, exactly as with the
first hatch, they take on the technique, the IP and the terms exposure by choosing to.

**Independently worth having, on either hatch:** results with `policy: "SNIP"` are now
dropped. Those are rights-gated uploads whose stream stops after thirty seconds while every
other field describes the whole song, and they are 3–16% of results depending on the query.
Listing one adds a second, shorter row for a song already present, and this provider's
`playback` is `queue`, which promises the song.

**There is a self-host route that does not need approval** — it works, it is
measured, and it is not a product feature. See the next entry.

---

## SoundCloud catalogue search via a self-hosted proxy `AVAILABLE (self-host only)`

*Verified end to end 2026-08-19. Not shipped, and deliberately not a hosted
capability.*

**What works.** [soundcloak](https://github.com/maid-zone/soundcloak) (AGPL-3.0,
Go, Docker) is a privacy frontend for SoundCloud that exposes an allowlisted
reverse proxy for `api-v2.soundcloud.com` at `/_/api/v2`, injecting the
`client_id` server-side. Measured against a live instance:

```
GET /_/api/v2/search/tracks?q=flume+remix
  200 · total_results 6321 · 47 fields/track · Access-Control-Allow-Origin: *
  limit=50 → 49 · limit=200 → 199 · limit=500 → 292   (~200/call ceiling)
  12 rapid searches → 200 ×12, no throttling
GET /_/api/v2/resolve?url=…/flume/never-be-like-you
  200 · title, duration, publisher_metadata.isrc = AUFF01500784
```

Timbre's own `SUGGESTED_SEARCHES` all return real catalogue depth — 27k results
for *Fred again..*, 21k for *boiler room set*, including 100-minute DJ sets and
two-hour Boiler Room recordings. This is the long tail the README is about.

**Why it is a self-host capability and not a feature.** The extraction technique
is the one the entry below `DECLINED`. It lives in someone else's AGPL repo, run
by the person who chose to run it, on their own residential IP. Timbre's hosted
deployment must never call `api-v2.soundcloud.com`, directly or through an
instance it operates.

**The shape, if it is ever built:** one optional `SOUNDCLOUD_API_BASE` in
`apps/web/lib/env.ts`, `search()` in `packages/providers/src/soundcloud.ts`
against `{base}/search/tracks`, and `searchable` flipped on **only when the
variable is set**. Unset by default, so the hosted build ships exactly as today.
Everything downstream — oEmbed, the Widget player, `resolveUrl` — is already
written and verified.

**Facts that shape any implementation:**

- **`EnableAPI` defaults to `false`** in soundcloak's config. A self-hoster must
  set it. Of ten public instances, six serve the API and the three that answer
  `404` are exactly the three reporting `EnableAPI: false`.
- **The proxy sets `Access-Control-Allow-Origin: *`**, so this can be a
  client-side fetch from the visitor's own IP — no serverless invocation, no
  shared egress IP, no cache. Same property that makes Audius safe to call
  directly. (`/_/searchSuggestions` does **not** set it; only the `v2` proxy does.)
- **ISRCs are present on 28% of results** (108/392 sampled) at
  `publisher_metadata.isrc` — a stronger merge key than Audius, which has none.
- **soundcloak also exposes playback** (`/_/api/hls/…`, `/_/api/progressive/…`,
  `/_/api/restream/…`) and autocomplete (`/_/searchSuggestions`). Neither is
  needed — the Widget already works — but they exist.
- **The working instance set was stable across re-sampling** (two samples ~2h
  apart, 2026-08-19): the same six answered `200` both times, the same three
  `404`ed with `EnableAPI: false`, and `total_results` for the same query agreed
  within 1% across instances (6242–6321 — they hold independent `client_id`s and
  caches). One instance (`soundcloak.nadeko.net`) degraded from `404` to a
  connection failure. Two samples is not an uptime study, but the failure mode
  looks like ordinary instance churn rather than the technique breaking.
- **The dependency is one person's project, last pushed 2026-05-30.** The
  optional-env-var shape is what contains that: if soundcloak dies, the hosted
  deployment is untouched and a self-hoster loses a capability rather than the
  product.

---

## SoundCloud via extracted `client_id` `DECLINED`

*Considered 2026-08-15. Recorded so it is decided once.*

**It works.** Every functioning SoundCloud integration does the same thing:

- **yt-dlp** fetches `https://soundcloud.com`, scans `<script>` tags in reverse for
  `client_id\s*:\s*"([0-9a-zA-Z]{32})"`, caches it, re-extracts on 401/403, and
  calls `api-v2.soundcloud.com`. Full `/search/tracks`, `/resolve`, `/tracks/{id}`.
- **`soundcloud-scraper`** (npm, usable directly in this stack) does the same via
  `SoundCloud.keygen()`, handling rotation automatically.

**Nine implementations were read in full (2026-08-19), and they are the same
program.** yt-dlp, NewPipe, SearXNG, cobalt, Mopidy-SoundCloud, muffon,
soundcloak, `nuclear-plugin-soundcloud` and `nuclear-plugin-omnisource` — the last
two using a byte-identical regex, independently. **`DECLINED` therefore describes a
universal, not a preference:** there is exactly one technique and everyone uses it.
Two details worth keeping:

- **The newer ones do not scan bundles at all.** cobalt and soundcloak read the id
  from the homepage hydration blob and key their cache on `window.__sc_version`,
  a build number — so extraction costs one conditional homepage `GET` per
  SoundCloud *frontend deploy*, not per query. It needs no background job and no
  server.
- **The Auryo precedent is weaker than this entry treats it.** Auryo had a
  *registered App ID that SoundCloud could revoke by name*, and that is what made
  it killable. None of the nine register anything; yt-dlp and NewPipe have run
  this way for years. The precedent argues against *registering* and then abusing
  it, which is not quite the route being declined. Recorded because this entry
  currently reads as stronger evidence than it is — **the terms argument above is
  the load-bearing one, and it is untouched.**

**Declined because:**

- SoundCloud's API terms explicitly forbid accessing the API without registering,
  reverse engineering, and circumventing data-security measures. This is inside
  all three.
- client_ids rotate, so it needs live re-extraction to stay working.
- ~15,000 calls/day ceiling per id.
- **Auryo** — the Electron SoundCloud desktop client — did exactly this and is
  **discontinued**: SoundCloud blocked OAuth tokens issued from its App ID and it
  broke. This is not a hypothetical risk.

**The honest tension.** Timbre already takes this posture with YouTube Music:
`ytmusicapi` is unauthenticated and rides YouTube's private InnerTube API for
search, while playback goes through the sanctioned IFrame player —
`apps/ytmusic/app/routes/search.py` says so outright. Declining the same technique
for SoundCloud is therefore **a choice about SoundCloud, not a principle the
project holds**. Recorded rather than smoothed over.

Note that even on this route playback would stay sanctioned: the Widget still
streams from SoundCloud with their branding and play counts. The extraction only
answers *"which track is this"*.

---

## Spotify `DEFERRED`

*Checked 2026-08-15.*

**Playback is not the blocker.** `open.spotify.com/embed/track/{id}` needs no key.
But it is `playback: "manual"` — the embed exposes **no play API**, so it cannot be
script-started. That is the embed's actual surface, and it is also what keeps it
clear of Developer Terms §IV.2 on blending streams. It can only ever be a separate
attributed panel, never a queue member. `types.ts` already defines `"manual"` for
exactly this.

**The blocker is the track id**, which is no longer obtainable for free (see
below). *There is a caveat on this framing — a user's own PKCE token would yield
the id at no cost, and the real cap is Spotify's five-user app quota rather than
the id itself. That route is researched but unverified, so it lives in
[SUGGESTIONS.md](SUGGESTIONS.md#s-2--spotify-via-the-users-own-pkce-token-speculative) rather
than here.*

**Measured 2026-08-19, and it closes off the route desktop apps take.** Nuclear's
Spotify plugin does not use a developer app at all — it impersonates the web
player, minting anonymous tokens at `open.spotify.com/api/token` behind a TOTP
signature. **A browser cannot follow it:**

| Endpoint | HTTP | `Access-Control-Allow-Origin` |
|---|---|---|
| `open.spotify.com/embed/track/{id}` | 200 | none — **iframe only, no key needed** |
| `open.spotify.com/api/token` | 400 | **none** |
| `open.spotify.com/api/server-time` | 200 | **none** |

The token endpoints are unreachable from JavaScript, and the request headers the
technique depends on (`Origin`, `Referer`, `User-Agent`) are
[forbidden header names](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name)
that a browser will not let script set. Nuclear can do it because its requests
come from Rust. Routing it through a Next.js function instead would put *Timbre's*
server and IP behind the impersonation. **Not a gap to close — a road that is
closed.**

**Catalogue search is further out of reach than the roadmap assumed.** Feb 2026:
Premium became mandatory for Development Mode, the test-user cap dropped 25 → 5,
and extended quota now requires a registered business with **250k monthly active
users**. Unblocked only by paying, which collides with the standing non-goal of
paying for developer accounts.

### Update 2026-08-20 — searchable, on the reader's own account

`SUGGESTIONS.md` S-2 reasoned that a user's own PKCE token would yield the id for free and
that the real cap is the app quota rather than the id. **Built, and the reasoning held.**

The two facts that decide it were measured rather than read: `accounts.spotify.com/api/token`
preflights `204` and `api.spotify.com/v1/search` answers with `access-control-allow-origin`
echoing the page's origin. So the whole flow runs in the browser, needs no client secret, and
**the token never reaches Timbre's server** — which is not a nicety here, it is what lets an
app that stores nothing about anyone hold a credential at all.

What has *not* changed, and is not a limitation to route around:

- **Spotify results are a separate attributed section, never merged into the ranked list**,
  and each row stays `playback: "manual"`. §IV.2 forbids blending, and the embed exposes no
  play API, so the rule and the surface agree — as this document already said.
- **Five users per app, owner must hold Premium.** Unchanged, and re-verified 2026-08-20. A
  copy of Timbre therefore cannot ship a client id; the panel accepts one so that anyone
  running their own registers their own app without rebuilding.
- The blocker on the *hosted* build is the same as it ever was. Nothing is shipped enabled.

**What is untested, and by whom.** Everything up to the redirect is verified in a browser —
the authorize URL carries `response_type=code`, `S256`, a 43-character challenge and a random
state; a replayed code is refused on the state check and stripped from the address bar;
Spotify accepts the request and serves its login page. The token exchange and a live search
are **not** verified, because doing so needs a registered app and a Premium account. Results
rendering and hand-off to the embed were exercised against a stubbed search response.

---

## Cross-service discovery `BLOCKED`

*Checked 2026-08-19. Was `REGRESSED`; the mechanism below is now measured rather
than reported.*

**Odesli / Songlink retired its public API on 31 July 2026.** The keyless
`v1-alpha.1` namespace answers:

```
GET https://api.song.link/v1-alpha.1/links?url=…   401
GET https://api.odesli.co/v1-alpha.1/links?url=…   401
{"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}
```

Verified deterministic across both hostnames and three seeds (SoundCloud, Spotify,
YouTube), paced. It was the one free, keyless way to map a song onto its
equivalent on another service, by URL or by ISRC.

**This is the root cause of both gaps above.** Even with free embeds for SoundCloud
and Spotify, there is no free way to learn *which* track to embed.

**A correction, and a trap for whoever re-checks this.** Through mid-August the
endpoint answered `200` rather than `410`, which briefly looked like the shutdown
had been walked back. It had not — that was a grace window, and it has closed.
Two things made the `200`s misleading and are worth not rediscovering:

- **It never returned SoundCloud or Spotify as *matches*.** Both were *seed-echo
  only*: they resolved when given and were never returned from another seed. A
  Flume track seeded from its SoundCloud URL returned a Deezer link; that same
  Deezer link re-seeded returned seven entities with SoundCloud absent. So even
  while it worked, it could not answer Timbre's question.
- **Rate-limited responses soft-failed.** A `429` still rendered links while
  `entityUniqueId` was `null` — indistinguishable from a genuine non-match unless
  you check the status code. **Confirm negatives by raw HTTP status, never by an
  empty result set.** That rule is what caught the `401`.

**Checked and rejected as replacements:**

- **MusicBrainz** is genuinely free, keyless and ISRC-indexed, but measured
  2026-08-19: `GET /ws/2/url?query=url:soundcloud.com*` returns **`count: 0`** —
  there is not one SoundCloud URL entity in the entire database. Its Spotify links
  are predominantly artist-level profile URLs, not per-track. Unusable as a
  cross-service resolver; fine as an opportunistic identity source.
- **Songwhip**, the obvious first suggestion, was acquired by Sony Music's The
  Orchard in mid-2024 and shut down immediately. The rest of the smart-link field
  (SongPort, SoundLink, Linkfire, ToneDen) are artist link-page builders with no
  public resolve API.
- Commercial replacements exist with free tiers in the low hundreds of requests
  per month — nowhere near enough, and they reintroduce a paid dependency.

**No free cross-service resolver exists.** This is now a settled finding rather
than a regression to watch.

---

## Facts worth not rediscovering

Each of these cost time to establish.

- **`soundcloud.com/oembed` returns `200` with no credentials.
  `api.soundcloud.com/oembed` returns `401`.** Most documentation and search
  results cite the `api.` host, which makes free embedding look impossible when it
  is not.
- **SoundCloud uploaders can disable embedding per track** via the Permissions
  tab, so it has the same per-track refusal problem as YouTube. `soundcloud.ts`
  returns `null` on 403/404 for this reason.
- **SoundCloud serves 30-second previews that look like ordinary tracks, and
  `streamable` does not detect them.** Measured 2026-08-19 across 392 tracks:
  **16% carry `policy: "SNIP"`**, where `duration` is `30000` and the real length
  is in **`full_duration`**. `streamable: true` on every one of them. Two
  consequences for any search integration:
  - **Read `full_duration`, not `duration`.** A merger comparing a 30 s snippet
    against YouTube Music's 4-minute recording will never match them. The two
    fields diverge by more than 5 s on **exactly** the SNIP tracks and nothing
    else (61/61 — either field detects it).
  - **Filter or badge `policy: "SNIP"`.** A queue member that plays 30 seconds and
    stops is a broken track, not a degraded one — the same class of trap as
    Audius's `stream_conditions`, which `audius.ts` already filters on.

  **The distribution is the interesting part.** SNIP tracked commercial release
  status almost perfectly: *Fred again..* 39/50, *Blinding Lights* 5/50, *Aphex
  Twin* 9/48, but **`boiler room set` 0/50** and `flume remix` 1/49. The part of
  SoundCloud that is preview-gated is the part every other source already has;
  **the long tail Timbre wants plays in full.** That is an argument for the
  product, not just a filter requirement.
- **Plays from third-party embeds count toward the artist** and appear in
  Insights. Embedding is invited, not merely tolerated — SoundCloud ships a
  Share → Embed flow for every public track.
- **Audius's decentralisation does not extend to the API Timbre calls.** Worth
  knowing before it is relied on. `/health_check` lists **76 registered nodes**
  (70 `validator`, 6 `content-node`), which is real — but those are chain
  consensus and file storage. **None of them serves `/v1`:** asked directly, 10 of
  10 returned `404` or `502`, and third-party discovery hostnames 404 too. The
  node-discovery endpoint that exists so a client can pick from many now returns
  **one entry**:

  ```
  GET https://api.audius.co  →  {"data":["https://api.audius.co"], …}
  ```

  **What failover does exist** — four hostnames, all `200`, all `ACAO: *`, all
  returning identical results, measured 2026-08-19:

  ```
  api.audius.co · discoveryprovider.audius.co
  discoveryprovider2.audius.co · discoveryprovider3.audius.co
  ```

  All four are `audius.co`. **A hardcoded fallback list of those four costs
  nothing and should exist** — the provider currently hits one hostname with no
  alternate. But treat Audius as *one vendor with redundancy*, not as a network
  that cannot be switched off. Audius is still the best free source available; it
  just does not carry the guarantee the "76 operators" number suggests.
- **Audius plays *do* count, and `skip_play_count=false` is what makes them.**
  Measured 2026-08-19 rather than assumed. `/v1/tracks/{id}/stream` answers `302`
  to a signed content-node URL with **`skip_play_count=true` appended by default**;
  passing `?skip_play_count=false` is honoured and carries through to the node. A
  single 256 KB range request with the flag set moved a track's `play_count` from
  **29,931 → 29,932**. So this *is* verifiable from outside — read `play_count` on
  `/v1/tracks/{id}` before and after.

  **Unresolved:** the per-request semantics. Three range requests — what an
  `<audio>` element makes while seeking — produced a delta of more than one, but
  the track carries live traffic from real listeners, so a clean increment could
  not be isolated. **Do not assume one listen equals one play**; if inflated counts
  ever matter, re-measure on a track with no other traffic.
- **MusicBrainz `403`s a generic User-Agent.** It is a User-Agent policy, not a
  block or a rate limit — send a descriptive one and the same request answers
  `200`. Measured 2026-08-19, and it cost time twice. It also sends
  `Access-Control-Allow-Origin: *` and `X-RateLimit-Limit: 1200`, which is far
  more generous than the one-request-per-second folklore.
- **MusicBrainz search ranks variants above the recording you asked for.** A
  `Never Be Like You` lookup scores the **instrumental at 100** and every real
  recording at 92 (measured 2026-08-19). A caller taking the top hit gets the
  wrong recording with maximum confidence. Variant-awareness is a *lookup*
  concern, not only a merge concern.
- **ListenBrainz's `/1/metadata/lookup` now requires an `Authorization` header**
  (`401`, measured 2026-08-19). The keyless path is
  `labs.api.listenbrainz.org/recording-search/json`, **POST only**, with a JSON
  array body — `GET` is rejected outright. It returns the MBID directly and keeps
  remix variants as distinct recordings.
- **Piped and Invidious are not a usable fallback ladder.** Measured 2026-08-19:
  Piped **1 of 4** instances alive (`pipedapi.kavin.rocks` still `502`), Invidious
  **0 of 3** — all three refuse anonymous API access (`403`/`401`).
- **Embeddability cannot be determined server-side on YouTube.** A barred upload
  still answers oEmbed `200` and reports `playableInEmbed: true`. Only the embedded
  player knows, by trying. See `docs/BUGS.md`.
- **A VPN changes YouTube's behaviour.** Invidious' documentation states YouTube
  blocks datacenter and VPN IP ranges. If playback goes flaky, check whether a VPN
  is active before assuming a code bug.
- **That blocking hits video *delivery*, not search — which is why Timbre can be
  hosted on a datacenter IP at all.** Worth stating precisely, because the line
  above reads as a blanket ban and was nearly taken as one. Invidious'
  [error documentation](https://docs.invidious.io/youtube-errors-explained/)
  separates the two: a blacklisted IP produces `403`s on `googlevideo.com`
  videoplayback URLs, while "other functions such as viewing channels pages may
  still work". Invidious suffers badly because it **proxies video through its own
  server**. Timbre never does: the sidecar only ever fetches metadata, and
  playback runs in the visitor's browser on *their* residential IP via the IFrame
  player. The ToS rule that Timbre hosts nothing puts it on the surviving side of
  this line — a structural accident worth not undoing.
  Corroborating: `ytmusicapi`'s tracker has no cluster of "search broke on my
  VPS" reports, and its environment-dependent issues are all *authenticated*
  ones (cookies going `logged_in: 0` on headless servers). Timbre calls
  `YTMusic()` with no credentials, so there is no cookie to invalidate. The real
  guest-session limit is volume — yt-dlp's wiki puts it near 300 items/hour.
  **Still verify empirically before launch**; this is an argument that the risk
  is small, not evidence that it is zero.

---

## Apple Music similar/related tracks `BLOCKED`

*Checked 2026-08-15.*

**Blocked by:** the endpoint does not exist. The public iTunes Search API and the
Marketing Tools RSS feeds offer search, lookup and charts — there is no related,
similar, radio or continuation endpoint at any tier. The Apple Music API proper
has them, and needs a paid Apple Developer membership plus a signed JWT.

**Consequence:** Apple contributes nothing to recommendations. It abstains rather
than guessing, and the ranker treats a missing list as no evidence rather than as
evidence against. Apple still contributes charts, artwork and availability.

**Unblocked by:** paying for a developer membership, which is a standing non-goal.

**Not blocked, and worth knowing: the iTunes Search API is browser-callable.**
Measured 2026-08-19 with `Origin: http://127.0.0.1:3000` — `200` with
`Access-Control-Allow-Origin: *`, no key. Of the sources Timbre touches, only
Audius, MusicBrainz, Internet Archive and iTunes send that header; **Deezer does
not**, so Deezer can only ever be called server-side. That asymmetry decides which
provider can spend a visitor's IP instead of Timbre's shared egress IP, and it is
not recorded anywhere else in this repo.

---

## Deezer track-level related tracks `BLOCKED`

*Checked 2026-08-15.*

**Blocked by:** `GET /track/{id}/related` is not a route on Deezer's API. It
answers `InvalidQueryException` code 600, not 404 — worth knowing, because it
reads like a malformed request rather than a missing feature.

**Not blocked:** `/artist/{id}/related` (similar artists), `/artist/{id}/top` and
`/artist/{id}/radio` all work keylessly. So Deezer can only start a radio from an
**artist**, never from a track, which is why `RadioSeed` carries both a source id
and an artist name.

**Also worth not rediscovering:** `/artist/{id}/radio` is a deep-cuts feed. Seeded
on *As It Was* it shared **zero** tracks with YouTube Music's lists, while
`/artist/{id}/top` shared six. Timbre uses `/top`, because a list nothing else
agrees with cannot contribute to a consensus score. See
[RECOMMENDATIONS.md](RECOMMENDATIONS.md).
