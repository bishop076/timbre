# Suggestions

Ideas that are **not verified working**. Everything here is either read from
someone else's source, reasoned from documentation, or measured only in part.

`docs/BLOCKED.md` records what other people gate, and every claim in it is
measured. `docs/BUGS.md` records our defects. **This file records things that
might be true.** Nothing should move from here into a doc or into code without
being measured first — and when something is measured, move it and delete the
entry rather than leaving both.

Each entry: what it is · what is actually known · what would have to be measured
to promote it · why it is not already done.

Status: `PROMISING` · `SPECULATIVE` · `PARKED` · `REJECTED`

---

## S-1 · A beets-style distance model for the matcher `PROMISING`

*Read from beets' source, 2026-08-16. Not prototyped against Timbre's data.*

`packages/providers/src/merge.ts` scores candidates. beets has spent a decade on
the same problem and reaches a different shape:

- **Distance, not score.** Accumulate weighted penalties and normalise by
  `dist_max`, so adding a new penalty rescales the others instead of silently
  reweighting everything that came before.
- **Confidence from the runner-up gap.** `results[1].distance - results[0].distance
  >= gap_thresh`. A match is confident because #1 beats #2 decisively, not because
  #1 scored well — which gives the merger a **"don't know"** verdict it currently
  lacks. "Don't know" is the right answer for the near-duplicate cases that matter
  most.
- **Per-penalty caps (`max_rec`) as the home for the variant rule.** `(Live)` /
  `(Acoustic)` / `- Remix` disagreement becomes a penalty capped at `none`: it can
  never produce a confident match however well everything else scores, but it
  still participates in ranking. Same protection as a boolean guard, better
  composition, and the rule becomes data rather than a branch.

**To promote:** port the distance calculation, run it against the fixtures already
in `packages/providers`, and check it does not regress any current merge. The
variant rule in particular needs a test before it is rewritten — see S-8.

**Why not yet:** it is a rewrite of the one piece of Timbre that is genuinely its
own, and the current scorer is not visibly failing. Sequencing, not doubt.

---

## S-2 · Spotify via the user's own PKCE token `BUILT 2026-08-20`

*Reasoned from Spotify's developer documentation, 2026-08-16. **Never executed** —
no app was registered and no token was minted.*

> **Built 2026-08-20.** The reasoning held: the flow runs entirely in the browser, both
> endpoints answer it with CORS, and no secret is needed. See `docs/BLOCKED.md` for what was
> measured and what remains unverified without a registered app. The prediction at the foot
> of this entry — that the ceiling is a panel rather than a source — was correct and is what
> the implementation does.

`docs/BLOCKED.md` states the Spotify blocker as "the track id, which is no longer
obtainable for free." That framing may be wrong, and the correction changes what
kind of problem it is.

**The chain, as documented:**

1. The user authorises Timbre with **their own** Spotify account using
   Authorization Code + PKCE — the flow intended for SPAs, requiring no client
   secret and safe to run entirely in the browser.
2. Timbre calls `/search` with **that user's** token and gets the track id free.
3. Timbre renders `open.spotify.com/embed/track/{id}`.
4. The embed plays full tracks, because the user is signed into Spotify in that
   same browser. *(Step 4 is the one part that is measured — the embed answers
   `200` with no key. See `BLOCKED.md`.)*

**What actually caps it, if the above holds:** the app quota, not the id.
Development Mode reportedly allows **5 users** and one client ID, the app owner
must hold Premium, and extended access requires a registered business with 250k
MAU. So it would work — for you and four other people.

**To promote:** register an app, run the PKCE flow, confirm `/search` returns ids
on a free account's token, and confirm the five-user cap empirically. All of that
is cheap except that it means creating a developer account.

**Why it stays here:** every number above is read, not measured, and the ones that
matter most (the user cap, the Premium requirement) are exactly the ones that
change quietly. Also — even fully working, §IV.2 confines Spotify to a separate
attributed panel, never a queue member. **The ceiling on this work is a panel, not
a source.**

---

## S-3 · Harmony's merge model — combinable vs immutable properties `PROMISING`

*Read from `kellnerd/harmony` source, 2026-08-19. MIT-licensed, TypeScript.*

The closest prior art to Timbre's merger found anywhere: a music metadata
aggregator whose entire job is combining releases from 13 providers. Three ideas
worth taking:

- **Properties split into combinable and immutable.** `externalLinks` and
  availability merge across providers; `title`, `artists`, `isrc` and `length`
  must be taken **whole from a single provider**. Timbre's variant rule is one
  instance of a general principle — *some fields are evidence, some are identity.*
- **Incompatibility is reported, not resolved.** Where providers disagree on a
  key property, Harmony clusters them by the conflicting value, drops the
  incompatible ones and returns an `IncompatibilityInfo[]` explaining why —
  instead of silently picking a winner. This is the structural answer to the
  failure mode S-8 is about.
- **Provenance is first-class.** The merged release carries a `sourceMap` naming
  which provider each field came from. A merged track can explain itself, which is
  a debugging tool and a UI feature at once.

**To promote:** read `harmonizer/merge.ts`, `compatibility.ts` and
`properties.ts`, then decide whether `SourceTrack` should carry provenance. Note
this is a *release*-level model and Timbre is track-level, so it is a source of
ideas rather than code to port.

**Why not yet:** it pairs naturally with S-1 and should be considered at the same
time, not before.

---

## S-4 · Capabilities as declared arrays, replacing `searchable: false` `PROMISING`

*Read from nuclear's plugin SDK, verified still current 2026-08-19.*

`searchable: false` is a one-bit approximation of a richer idea. Nuclear models it
as arrays:

```ts
searchCapabilities?: ('tracks'|'artists'|'albums'|'playlists')[]
artistMetadataCapabilities?: (...)[]
streamingProviderId?: string   // metadata provider names its paired stream source
```

Every method optional, arrays declare what is implemented, the registry fans out
only to claimants, and a `MissingCapabilityError` catches a provider that declares
what it does not implement. A boolean says "SoundCloud cannot search." An array
says "searches tracks and artists, not albums" — which is the shape reality has.
`streamingProviderId` is the type-level version of the metadata/playback split
Timbre already has informally.

**To promote:** it is a change to `packages/providers/src/types.ts` and every
provider at once. Worth doing when that file is next opened for another reason,
not on its own.

**Why not yet:** four sources do not need it. It earns its keep at eight.

---

## S-5 · Splitting queue identity from playback resolution `PARKED`

*Architectural, from ListenBrainz's Troi. Not prototyped.*

A queue entry would be a *recording*, not a source-bound track; which provider
plays it resolves at playback time. "SoundCloud unshipped" becomes a resolution
outcome rather than a structural absence, playlists survive a source dying, and
the fall-through ladder in `docs/BUGS.md` becomes the general case rather than a
YouTube special case. Emitting **JSPF** would make playlists portable out of
Timbre.

**Why parked:** this is the largest change on this list and it touches the queue,
the player and the playlist store together. It is the right shape; it is not the
right next thing.

---

## S-6 · SoundCloud's sitemaps as a searchable corpus `REJECTED`

*Considered 2026-08-19.*

SoundCloud publishes `/sitemap.xml` and `/sitemapIndex.xml`, and its `robots.txt`
permits general crawlers on all UGC — only `/search`, `/you/`, `/stream`,
`/upload`, `/settings`, `/messages` and `/*?` are disallowed. Slugs carry artist
and title (`/flume/hyperparadise-flume-remix`), so a URL list is close to a
searchable index, and it needs nobody's permission.

**Rejected because** there is nowhere to put it. Timbre has no database by
deliberate architecture (see `notes/WORKSTREAMS.md`), and a hundreds-of-megabytes
index does not fit in a Vercel bundle. The self-hosted soundcloak route in
`BLOCKED.md` reaches the same catalogue with better data and no storage at all.

**Also worth recording:** an agent doing this research cannot crawl those sitemaps
itself. `robots.txt` places `ClaudeBot` and `Claude-Web` in the restricted class —
an allowlist of editorial pages, then `Disallow: /`. Timbre is not in that class;
an agent is.

---

## S-7 · Running a search index or metasearch (SearXNG, YaCy) `REJECTED`

*Measured 2026-08-16, re-checked 2026-08-19.*

The original plan for SoundCloud search was to query a web index filtered to
`site:soundcloud.com` and resolve the results through oEmbed. The legitimacy
argument is sound and the resolve half measured **10/10**. It is still rejected:

- **Public SearXNG instances cannot be used.** Of eight asked for `format=json`:
  four `429`, one `403`, two served HTML because JSON is off by default, one DNS
  failure. **Zero** served JSON. So it is not an optimisation to add later — it is
  a container you must run before you can test the idea at all.
- **It is a third deploy target.** `docs/DEPLOY.md` settled on two serverless
  projects specifically because a function has no idle to sleep through. SearXNG
  is a scraper that upstream engines CAPTCHA on datacenter IPs.
- **The data is worse.** ~10 URLs plus an oEmbed call each, versus ~200 results
  with full metadata in one call from the soundcloak route.

**Do not enable SearXNG's built-in `soundcloud` engine if this is ever revisited.**
It extracts a `client_id` and calls `api-v2.soundcloud.com` — it is the `DECLINED`
technique in a container, and it would be easy to land inside that entry without
noticing.

---

## S-8 · A test for the variant rule `DONE`

*Settled 2026-09-11 — kept as a pointer, per this file's own rule, rather than as a suggestion.*

The rule that `(Live)`, `(Acoustic)` and `- Remix` are variants that must agree before two
tracks merge no longer rests on prose: `packages/providers/src/merge.test.ts` holds a live
take against the studio version, a remix with no ISRC to backstop it, and an acoustic version
spelt two ways, and `packages/core/src/normalize.test.ts` covers the parsing underneath. The
two counterexamples that made this urgent — Audius's all-variant catalogue with no ISRCs, and
MusicBrainz ranking an instrumental above its recording — are exactly what those cases pin.

---

## S-9 · Sources surveyed and not taken `PARKED`

Measured 2026-08-19 unless noted. Kept so none is rediscovered as a fresh idea.

| Source | Keyless | Browser-callable | Verdict |
|---|---|---|---|
| **iTunes Search** | yes | **yes** (`ACAO: *`) | **Tested 2026-08-19 — not worth adding.** See below. |
| **Internet Archive** | yes | **yes** | **Tested 2026-08-19 — narrower than it sounds.** See below. |
| **LRCLIB** | yes | **yes** (`ACAO: *`) | Already used for lyrics. Re-verified working — synced lyrics returned for both a 1995 chart song and a 2025 release. No change needed. |
| **Deezer** | yes | **no ACAO** | Already used. Server-side only, permanently. |
| **ccMixter** | yes | no | Looked ideal — CC-licensed with remix lineage. The documented query API exposes no source/remix relationship, which was the only reason to want it. |
| **Jamendo** | needs `client_id` | no | Free account, CC catalogue, license filters. Brushes the no-developer-accounts non-goal without clearly crossing it. |
| **Openverse** | yes | yes | **200 requests/day** anonymous — a handful of visitors on one egress IP would exhaust it. Audio index is essentially Jamendo with a wrapper. |
| **Free Music Archive** | — | — | **Dead.** `/api/trackSearch` returns 404. |
| **AcoustID / Chromaprint** | yes | n/a | **Structurally incompatible** — fingerprinting requires possessing decoded audio, which Timbre never holds. Recorded so it is not reconsidered. |

### iTunes as a *search* source — measured, and the answer is no

An earlier version of this file called this "the one genuine gap." It was tested
2026-08-19 against Timbre's own `SUGGESTED_SEARCHES`, and the claim does not hold.

**What it is good at** is the exact inverse of Audius and SoundCloud: canonical
originals with trustworthy durations. `Wonderwall` returns Oasis, a Ryan Adams
cover and the remaster; `Aphex Twin` returns *Xtal*, *Alberto Balsalm*,
*Windowlicker*. Unlike SoundCloud's SNIP tracks, `trackTimeMillis` is the **full**
length, so durations can be trusted for matching.

**Two things rule it out as a search source:**

- **It fails on exactly the queries that motivate the product.** `boiler room set`
  returned three unrelated songs *named* "Boiler Room"; `lofi study mix` returned
  generic filler. No sets, no long-form, no remixes — the catalogue YouTube Music
  already covers, minus everything Timbre exists for.
- **It carries no ISRC.** All 31 result fields were enumerated and there is none,
  and `lookup?isrc=…` returns `resultCount: 0`. So it cannot act as an identity
  layer either — it would fall through to title+artist+duration, the same weak path
  as Audius.

**Keep using it for what it already does** — charts, artwork, availability — and
stop treating it as an unexplored source. That question is now answered.

### Internet Archive — real, but a narrower slice than it sounds

Also tested 2026-08-19. An earlier version of this file called it "the closest
catalogue match to SoundCloud's live/bootleg appeal." That overstated it.

- **Free-text search is unusable.** `Grateful Dead AND collection:etree` returns
  29,296 hits whose top results are *Xtra Ticket*, *Alvar Hanso* and *Morrow and
  Ford* — not the artist asked for. Any integration must scope the field:
  `creator:"Grateful Dead" AND collection:etree` returns **18,335** correct
  recordings.
- **The collection is taper culture, not the mainstream catalogue.**
  `creator:"Sade"` returns **0**. Five of Timbre's six suggested searches would
  come back empty or wrong.

So it is a genuine, legitimately-licensed, browser-callable archive — for jam
bands and the taping scene specifically. Worth having if that catalogue is ever
wanted deliberately; it is not a SoundCloud substitute and should not be filed as
one.

**The pattern worth keeping:** everything that closed recently — Odesli,
ListenBrainz's metadata lookup, the FMA API, Songwhip — was a free tier granted by
a company. Everything that held is ungated for a *structural* reason rather than a
generous one: MusicBrainz is a non-profit with a published UA policy, the Internet
Archive is an archive.

**Audius is the qualified case, and the qualification was measured.** Its 76
registered nodes are chain validators and content storage; **none serves the `/v1`
API**, and the node-discovery endpoint advertises only `api.audius.co`. See
`BLOCKED.md` for the numbers and for the four-hostname fallback list that should
exist. It is one vendor with redundancy — still the best free source found, but it
does not carry the guarantee its architecture implies.

---

## S-10 · Hardcode the Audius discovery fallback list `PROMISING`

*Measured 2026-08-19. The smallest real availability win on this list.*

`packages/providers/src/audius.ts` points at a single hostname. Three more serve
identical results with `ACAO: *`:

```
api.audius.co · discoveryprovider.audius.co
discoveryprovider2.audius.co · discoveryprovider3.audius.co
```

**To promote:** decide whether it is worth the complexity in `createRequester`,
and confirm the three alternates are stable over more than one day — they were
sampled once. Do **not** build dynamic node discovery from `/health_check`: those
76 endpoints do not serve `/v1` and 10 of 10 returned 404/502 when asked.

**Why it is a suggestion and not a fix:** one measurement is not an uptime study,
and a fallback list that is itself stale is worse than none.
