# Timbre — Implementation Plan

> **One library across Spotify, YouTube Music, and SoundCloud.**
> Unified browsing and search first; playlist sync and transfer second.

**Status:** Phase 0 (foundation) complete and verified · Phase 1 not started
**Last updated:** 14 August 2026

---

## Contents

1. [Why the architecture looks like this](#1-why-the-architecture-looks-like-this)
2. [What we're building](#2-what-were-building)
3. [Architecture](#3-architecture)
4. [Roadmap](#4-roadmap)
5. [Key risks](#5-key-risks)
6. [Verification](#6-verification)
7. [Decision log](#7-decision-log)
8. [Sources](#8-sources)

---

## 1. Why the architecture looks like this

Timbre's whole shape is dictated by one research finding: **two of the three services will not give a new public app usable API access.**

| Service | Access reality (August 2026) | Consequence |
| :--- | :--- | :--- |
| **Spotify** | Development Mode capped at **5 users** per app; owner needs Premium. Extended quota requires a registered business, a launched service, and **250,000 MAU**. Batch endpoints removed, search capped at 10 results, other users' playlists unreadable. | A centrally-keyed public app is **impossible**. |
| **YouTube Music** | No official API. `ytmusicapi` (Python, maintained) authenticates with a **user-supplied** Google client ID/secret. The official Data API v3 allows 10,000 units/day ≈ **200 track-adds**. | Central keys are quota-starved and ToS-exposed. |
| **SoundCloud** | Self-service registration **reopened May 2026** for Artist Pro subscribers. | The one service Timbre can key centrally. |

Spotify's rule is an explicit chicken-and-egg: you must already have 250k monthly active users before you are permitted to serve more than five.

> ### The organizing principle
>
> **Credentials belong to the user.**
>
> Spotify and YouTube both let an end user create their own free developer app, and both then charge that user's quota to their own account. If each user brings their own Client ID, Timbre inherits **no user cap, no quota ceiling, and no ToS liability** for those two services. SoundCloud, where registration is open, Timbre keys itself.

This converts Spotify's restriction from a hard blocker into a one-time onboarding wizard. It is the only known way to ship this product publicly today.

---

## 2. What we're building

**MVP outcome.** A user connects all three services and sees their entire saved library — liked songs and playlists across all three — in one searchable view.

Read-only. No writes to any service. Transfer and sync land in Phase 2 on the same foundation.

Two deliberate non-goals for the MVP:

- **No in-app playback.** Spotify playback needs Premium plus the Web Playback SDK; YT Music and SoundCloud playback is ToS-hostile. Timbre deep-links out instead.
- **No Spotify-as-login.** Spotify is a connection a user may never add or may disconnect. Losing your account because you unlinked a music service would be indefensible.

---

## 3. Architecture

A pnpm workspace with **two deployables**, because `ytmusicapi` is Python and has no viable TypeScript equivalent.

### Repository layout

```
timbre/
├── apps/
│   ├── web/            Next.js 16 (App Router) — UI, OAuth callbacks, API routes
│   └── ytmusic/        FastAPI + ytmusicapi — stateless, internal-only
├── packages/
│   ├── core/           canonical models, crypto, rate limiter, normalization
│   ├── providers/      MusicProvider interface + adapters
│   └── db/             Drizzle schema + migrations
└── docs/PLAN.md        this document
```

The `ytmusic` service **holds no secrets and never touches the database**. The web app decrypts a user's credentials and passes them per request, over loopback, behind a shared-secret header.

### The provider seam

Everything hangs off one interface in `packages/providers/src/types.ts`. Phase 1 implements the read half; the write half is declared and optional so Phase 2 is additive rather than a refactor.

```ts
interface MusicProvider {
  id: ProviderId                    // 'spotify' | 'ytmusic' | 'soundcloud'
  credentialMode: 'byo' | 'central'
  auth: AuthDriver
  setupGuide?: ByoSetupGuide        // drives the BYO onboarding wizard

  // Read — Phase 1
  listLikedTracks(ctx, cursor?): Promise<Page<ProviderTrack>>
  listPlaylists(ctx, cursor?): Promise<Page<ProviderPlaylist>>
  listPlaylistTracks(ctx, id, cursor?): Promise<Page<ProviderTrack>>

  // Write — Phase 2, optional
  search?(ctx, query, limit): Promise<ProviderTrack[]>
  createPlaylist?(ctx, input): Promise<ProviderRef>
  addTracks?(ctx, playlistId, ids): Promise<void>
}
```

Adapters normalize into a canonical `Track` (`isrc`, `title`, `artists[]`, `album`, `durationMs`). **Every service quirk stays inside its adapter** — nothing above this layer branches on `provider.id`.

### Data model

Defined in `packages/db/src/schema.ts`. Fourteen tables; the ones that carry the design:

| Table | Purpose |
| :--- | :--- |
| `users`, `accounts`, `sessions` | Auth.js. Who is signed in to Timbre. |
| `connections` | One row per (user, service). Encrypted tokens **and** encrypted BYO client credentials. |
| `tracks` | A recording, global and deduplicated across all users. ISRC-keyed where available. |
| `provider_tracks` | How one recording appears on one service. Global, keyed `(provider, provider_id)`. |
| `library_items` | A user's saved songs. The track is global; the act of saving it is personal. |
| `playlists`, `playlist_tracks` | Mirrored per connection, keyed by position so duplicates survive. |
| `sync_runs` | Per-run status and cursor. What makes ingest resumable. |
| `match_decisions` | Phase 2. Records auto-matches and user overrides so a re-run never re-asks. |
| `rate_buckets` | Persisted token buckets, shared by web and worker processes. |

> **Security invariant.** Provider tokens and users' BYO client secrets are encrypted at rest with AES-256-GCM in a versioned envelope (`v1.<iv>.<tag>.<ciphertext>`). The key lives in the environment, never in the database. Rotating it invalidates every stored connection.

### Rate limiting and quota

A first-class component, not a retry helper — Spotify's removal of batch endpoints makes pacing the binding engineering constraint. Two budgets are modelled separately, and conflating them is the classic bug:

- **Rate** — requests per unit time. Recoverable in seconds. Wait, then continue.
- **Quota** — a hard allowance (Spotify's per-account pool, YouTube's 10k units/day). Recoverable only at reset. **Retrying is useless and burns tomorrow's budget.**

Spotify's July 2026 update added a `reason` field to the 429 body precisely so clients can tell these apart; `QUOTA_EXCEEDED` halts the run rather than backing off.

Reading a 2,000-track Spotify library is now roughly **2,000 individual requests**, so ingest must be a resumable background job (`pg-boss`, Postgres-backed) checkpointing its cursor into `sync_runs` — never a request handler.

---

## 4. Roadmap

### Phase 0 — Foundation ✅ complete

- [x] pnpm monorepo; Next.js 16 app; FastAPI sidecar
- [x] `MusicProvider` interface, registry, canonical models
- [x] Drizzle schema + first migration (14 tables, applied)
- [x] AES-256-GCM envelope encryption
- [x] Token-bucket limiter with quota-vs-throttle classification
- [x] Title/artist normalization with variant preservation
- [x] Auth.js v5 (database sessions) + `pg-boss` queue
- [x] `/api/health` aggregating both services
- [x] 23 unit tests passing; typecheck and build clean

### Phase 1 — Connect + unified library (the MVP)

- [ ] **SoundCloud adapter first.** Central credentials, simplest OAuth — proves the interface end to end with the fewest moving parts.
- [ ] **Spotify adapter + BYO wizard.** The highest-risk UX in the app: create app → copy this exact redirect URI → paste Client ID/Secret → validate. Needs a live validation step that says precisely which part failed.
- [ ] **YT Music adapter + sidecar implementation.** Same BYO wizard component, Google credentials.
- [ ] **Ingest jobs.** Liked songs and playlists per provider; resumable and rate-limited.
- [ ] **Unified library UI.** One virtualized list across all sources, filtering, full-text search over the local mirror so browsing costs zero API calls, per-track badges showing which services carry it.

### Phase 2 — Matching + transfer

- [ ] **Matcher.** ISRC first; fall back to normalized title/artist/duration (±3s) with a confidence score. Spotify's 10-result search cap means several narrow queries, not one broad one.
- [ ] **Review queue.** Auto-accept above threshold, one-tap human review below it, every decision persisted.
- [ ] **One-way transfer**, then scheduled two-way mirroring with conflict rules.

---

## 5. Key risks

| Risk | Mitigation |
| :--- | :--- |
| **BYO onboarding is the biggest funnel risk.** Asking a user to register a developer app is a real drop-off cliff. | Make SoundCloud (zero setup) the first-run connection so the app has value before Spotify is attempted. Treat wizard polish as a feature, not chrome. |
| **Spotify BYO requires the user to hold Premium** to own a dev app. Free-tier users cannot connect Spotify at all. | State it up front, not at step four. |
| **`ytmusicapi` is unofficial** and can break on any YouTube web change. | Pinned to a minor range and isolated in one deployable, so the blast radius is contained. |
| **Circumvention temptation.** A developer account now allows 25 Client IDs. | **Do not rotate them to evade the 5-user cap.** It reads as circumvention and risks the whole developer account. BYO is the sanctioned path. |

---

## 6. Verification

This app is almost entirely third-party integration, so mocks prove very little. Verification is against real accounts.

| # | Check | Status |
| :-- | :--- | :--- |
| 1 | `pnpm dev` + `pnpm dev:ytmusic`; `/api/health` reports both, and 503s when one is down | ✅ passing |
| 2 | Unit tests: limiter accounting, 429 classification, crypto round-trip and tamper detection, normalization | ✅ 23 passing |
| 3 | Connect all three providers; confirm `connections` rows hold ciphertext, not plaintext | ⬜ Phase 1 |
| 4 | Ingest counts **match the numbers each official app displays** — the real pass/fail for the MVP | ⬜ Phase 1 |
| 5 | Kill mid-ingest and restart; must resume from `sync_runs`, not restart | ⬜ Phase 1 |
| 6 | Force a 429; confirm backoff, and that `QUOTA_EXCEEDED` halts rather than hot-retries | ⬜ Phase 1 |
| 7 | Expire a token; confirm silent refresh, and that revocation prompts re-auth instead of crashing | ⬜ Phase 1 |

---

## 7. Decision log

Changes made during Phase 0 that differ from the original plan, and why.

**`provider_tracks` is global, not connection-scoped.**
Keyed by `(provider, provider_id)`, with a separate `library_items` join for per-user saves. The same Spotify track referenced by a thousand users is one row, and a match computed once becomes reusable — which matters when every Spotify lookup costs a request.

**`playlist_tracks` is keyed by `(playlist_id, position)`, not by track.**
A playlist may legitimately contain the same track twice, and playlist order must survive a transfer.

**Auth config is lazily initialized.**
Reading the environment at module scope meant `next build` demanded a live database and a full set of secrets just to collect page metadata.

**Normalization preserves variants.**
`(Remastered 2011)` and `(Official Video)` are stripped as noise; `(Live)`, `(Acoustic)` and `- Remix` are extracted as variants and compared. Collapsing them would silently swap a user's studio track for a live cut — the most damaging thing a playlist transfer can do.

> ### ⚠️ Known issue, deferred to Phase 2
>
> `match_decisions_scope_idx` is a unique index over `(source_track_id, target_provider, user_id)`, but `user_id` is nullable for global decisions and **Postgres treats NULLs as distinct** — so it does not currently prevent duplicate global rows. The table is unwritten until Phase 2. Fix with `NULLS NOT DISTINCT` (Postgres 15+) or two partial indexes before anything writes to it.

---

## 8. Sources

**Spotify**
- [Updating the Criteria for Web API Extended Access](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)
- [February 2026 Web API Dev Mode Changes — Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Web API quota updates for Development Mode (July 2026)](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)
- [Rate Limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)

**SoundCloud**
- [API Credentials from Your Terminal, and OpenAPI on GitHub](https://developers.soundcloud.com/blog/api-credentials-cli-openapi-github/)
- [Get an API key](https://developers.soundcloud.com/docs/api/register-app)

**YouTube Music**
- [ytmusicapi on GitHub](https://github.com/sigma67/ytmusicapi)
- [ytmusicapi — OAuth authentication](https://ytmusicapi.readthedocs.io/en/stable/setup/oauth.html)
- [YouTube Data API — quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
