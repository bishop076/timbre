# Timbre — Roadmap

Every task from foundation to public launch, in one list.

**Legend:** ✅ done · 🚧 in progress · ⬜ not started · 🔒 blocked on an external dependency

**Now:** Phase 0 complete. Phase 1 blocked on two accounts — see [Blockers](#blockers).

| Phase | Outcome | Status |
| :--- | :--- | :--- |
| [0 — Foundation](#phase-0--foundation) | The app runs, empty | ✅ complete |
| [1 — Connect + unified library](#phase-1--connect--unified-library) | **MVP.** See all three libraries in one view | ⬜ next |
| [2 — Matching + transfer](#phase-2--matching--transfer) | Move playlists between services | ⬜ |
| [3 — Sync](#phase-3--sync) | Keep services in step automatically | ⬜ |
| [4 — Public launch](#phase-4--public-launch) | Other people can use it safely | ⬜ |

---

## Blockers

Two external dependencies gate Phase 1. Neither is a code problem.

- 🔒 **SoundCloud Artist Pro subscription** — required to register an API app via `sc-api-auth.mjs`. Blocks the first adapter.
- 🔒 **Spotify Premium account** — required to *own* a Development Mode app. Blocks building and testing the BYO wizard.

---

## Phase 0 — Foundation

*The app runs end to end with nothing in it.*

### Workspace
- [x] pnpm monorepo: `apps/web`, `apps/ytmusic`, `packages/{core,db,providers}`
- [x] Next.js 16 (App Router, TypeScript, Tailwind 4)
- [x] Single root `.env` loaded by both Next and drizzle-kit via `dotenv-cli`
- [x] `docker-compose.yml` — Postgres 18 + Mailpit, bound to loopback
- [x] `.gitignore` covering `.env`, venvs, and `ytmusicapi` credential artifacts

### `@timbre/core`
- [x] Canonical models (`CanonicalTrack`, `ProviderTrack`, `ProviderPlaylist`, `Page<T>`)
- [x] AES-256-GCM envelope encryption, versioned for key rotation
- [x] Provider-neutral error taxonomy (`ProviderError`)
- [x] Token-bucket rate limiter, pure and unit-testable
- [x] `classify429` — distinguishes throttle from exhausted quota
- [x] Title/artist normalization that strips noise but preserves variants
- [x] 23 unit tests

### `@timbre/db`
- [x] Drizzle schema — 14 tables
- [x] Auth.js adapter tables
- [x] Postgres-backed bucket store, shared across processes
- [x] HMR-safe connection pooling
- [x] First migration generated and applied

### `@timbre/providers`
- [x] `MusicProvider` interface — read half required, write half optional
- [x] `ByoSetupGuide` type driving the onboarding wizard
- [x] Registry + `paginate` helper

### `apps/ytmusic`
- [x] FastAPI app, stateless, holds no secrets
- [x] Constant-time shared-secret guard
- [x] Open `/health`; route contracts returning 501

### `apps/web`
- [x] Zod-validated environment, fails loudly at boot
- [x] Auth.js v5, lazily initialized, database sessions
- [x] `pg-boss` queue with per-connection singleton keys
- [x] `/api/health` aggregating both services, 503 when degraded
- [x] `proxy.ts` route protection (Next 16 convention)

### Verified
- [x] `pnpm build` and `pnpm typecheck` clean
- [x] Migration applies; all 14 tables present
- [x] Health returns `ok`, and 503 naming the failure when the sidecar is down
- [x] Sidecar: 401 without secret, 501 with it
- [x] All services bound to `127.0.0.1`

---

## Phase 1 — Connect + unified library

*The MVP. A user connects all three services and sees everything in one place. Read-only.*

### 1.1 SoundCloud adapter — do this first
Central credentials and the simplest OAuth, so it proves the interface with the fewest moving parts.

- [ ] 🔒 Register the app (`sc-api-auth.mjs`; needs Artist Pro)
- [ ] OAuth authorize / exchange / refresh
- [ ] `listLikedTracks`, `listPlaylists`, `listPlaylistTracks`
- [ ] Normalize into canonical tracks; map errors to `ProviderError`
- [ ] Register in the provider registry

### 1.2 Connection plumbing
- [ ] `POST /api/connections/:provider/start` → authorize redirect
- [ ] `GET /api/connections/:provider/callback` → verify `state`, exchange, encrypt, store
- [ ] Token refresh on expiry, with revocation → `needs_reauth`
- [ ] Disconnect: delete connection and cascade its library rows
- [ ] Connections page listing status per service

### 1.3 Spotify adapter + BYO wizard
The highest-risk UX in the product.

- [ ] 🔒 Register a personal dev app (needs Premium)
- [ ] Adapter: OAuth with **user-supplied** client credentials
- [ ] Handle the Feb 2026 API shape — no batch endpoints, 10-result search cap, `/me` only
- [ ] Wizard: create app → copy exact redirect URI → paste credentials → validate
- [ ] Live validation naming precisely which field is wrong
- [ ] State the Premium requirement **before** step one
- [ ] Encrypt client secret alongside tokens

### 1.4 YouTube Music adapter
- [ ] Implement the sidecar routes against `ytmusicapi`
- [ ] OAuth with user-supplied Google credentials
- [ ] TypeScript adapter calling the sidecar; normalize there, not in Python
- [ ] Reuse the BYO wizard component with Google-specific copy
- [ ] Surface remaining daily quota units in the UI

### 1.5 Ingest
- [ ] Workers for `sync.liked`, `sync.playlists`, `sync.playlist-tracks`
- [ ] Checkpoint cursors into `sync_runs` after every page
- [ ] Route every request through the limiter
- [ ] Halt cleanly on `QUOTA_EXCEEDED`; resume next reset
- [ ] Skip playlists whose `snapshot_id` is unchanged
- [ ] Upsert canonical tracks, deduplicating by ISRC then `dedupeKey`
- [ ] Progress UI with per-connection sync status

### 1.6 Unified library UI
- [ ] Virtualized list across all sources
- [ ] Full-text search over the local mirror — zero API calls to browse
- [ ] Filter by provider, artist, album
- [ ] Per-track badges showing which services carry it
- [ ] Deep links out to each service
- [ ] Empty, loading, partial-sync and error states

### 1.7 Sign-in
- [ ] `/signin` page (magic link)
- [ ] Honest message when no sign-in method is configured
- [ ] Account settings; account deletion that actually deletes

---

## Phase 2 — Matching + transfer

*Move a playlist from one service to another without silently corrupting it.*

- [ ] Fix `match_decisions_scope_idx` — nullable `user_id` breaks uniqueness (see PLAN §7)
- [ ] ISRC-exact matcher
- [ ] Metadata fallback: normalized title + artists + duration (±3s), confidence-scored
- [ ] Require variant agreement — never match studio to live
- [ ] Several narrow Spotify queries instead of one broad one (10-result cap)
- [ ] Persist every decision; never re-ask or re-spend quota on a settled lookup
- [ ] Auto-accept above threshold; queue the rest
- [ ] One-tap review UI for ambiguous matches
- [ ] Record confirmed absences — "not available there" is an answer
- [ ] Implement the write half for each adapter
- [ ] Transfer flow: pick source → destination → preview → confirm
- [ ] Preserve playlist order and duplicates
- [ ] Transfer report: matched, ambiguous, unavailable
- [ ] Dry-run mode

---

## Phase 3 — Sync

*Keep services in step, without ever destroying data by surprise.*

- [ ] Scheduled re-sync per connection
- [ ] Change detection since last run
- [ ] Two-way mirroring with explicit conflict rules
- [ ] Deletion policy — default to never deleting remotely
- [ ] Sync history and an undo path
- [ ] Per-playlist opt-in rather than blanket sync

---

## Phase 4 — Public launch

*Other people can use this safely.*

### Security
- [ ] Move the encryption key to a managed KMS
- [ ] Key rotation path that re-encrypts without forcing reconnects
- [ ] Rate-limit Timbre's own endpoints
- [ ] Security review of the OAuth callback and `state` handling
- [ ] Confirm no tokens reach logs or error reports

### Operations
- [ ] Separate worker process from web
- [ ] Structured logging and error tracking
- [ ] Backups and a tested restore
- [ ] Health and quota dashboards
- [ ] CI: typecheck, tests, build on every push

### Product
- [ ] Landing page explaining BYO honestly, before signup
- [ ] Privacy policy — what is stored, where, for how long
- [ ] Terms of service
- [ ] Data export and account deletion
- [ ] Onboarding funnel metrics, to find where BYO loses people

### Compliance
- [ ] Re-verify each provider's ToS before launch
- [ ] Decide whether YT Music ships hosted or self-host-only
- [ ] Document the SoundCloud Artist Pro dependency

---

## Deliberate non-goals

Not oversights — decisions, revisitable with reason.

- **In-app playback.** Spotify needs Premium plus the Web Playback SDK; the other two are ToS-hostile. Deep-link out instead.
- **Spotify as a login provider.** It is a connection a user may disconnect; losing your account with it would be indefensible.
- **Evading the 5-user cap** by rotating the 25 Client IDs a developer account allows. It reads as circumvention and risks the account.
- **Multiple accounts per service.** One connection per service per user until someone actually asks.
