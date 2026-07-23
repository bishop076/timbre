# Timbre — Implementation Plan

## Context

`timbre` is a web app that unifies Spotify, YouTube Music, and SoundCloud into one library and syncs playlists between them.

Research into the current (Aug 2026) API landscape turned up one finding that dictates the whole architecture:

| Service | Access reality | Consequence |
|---|---|---|
| **Spotify** | Dev Mode capped at **5 users**/app (Feb 2026), owner needs Premium. Extended quota requires a registered business + launched service + **250k MAU**. Batch endpoints removed; search capped at 10 results; other users' playlists unreadable. | A centrally-keyed public app is **impossible**. |
| **YouTube Music** | No official API. `ytmusicapi` (Python, maintained) supports OAuth with a **user-supplied** Google client ID/secret. Official Data API v3 = 10k units/day ≈ 200 track-adds. | Central keys are quota-starved and ToS-exposed. |
| **SoundCloud** | Self-service registration **reopened May 2026** for Artist Pro subscribers. | The one service Timbre can key centrally. |

**The organizing principle: credentials belong to the user.** Spotify and YouTube both let an end user create their own free developer app, and both then treat that user's quota as their own. By having each user bring their own Client ID, Timbre inherits no cap, no quota ceiling, and no ToS liability for those two. SoundCloud, where registration is open, Timbre keys itself.

This turns Spotify's restriction from a blocker into a one-time onboarding wizard, and it is the only known way to ship this product publicly today.

**MVP outcome:** a user connects all three services and sees their entire saved library — liked songs and playlists across all three — in one searchable view. Read-only. Transfer/sync lands in Phase 2 on the same foundation.

## Architecture

pnpm workspace monorepo. Two deployables, because `ytmusicapi` is Python and has no viable TS equivalent.

```
timbre/
  apps/
    web/            Next.js (App Router, TS) — UI, OAuth callbacks, API routes
    ytmusic/        FastAPI + ytmusicapi — thin JSON wrapper, internal-only
  packages/
    providers/      MusicProvider interface + 3 adapters
    core/           canonical models, normalization, matching (Phase 2)
    db/             Drizzle schema + migrations
  docs/PLAN.md      this document
```

The `ytmusic` service is stateless and holds no secrets: `web` passes the user's decrypted YT token per request, over an internal network with a shared-secret header. It never talks to the database.

### The provider abstraction

Everything hangs off one interface in `packages/providers/src/types.ts`. Phase 1 implements only the read half; the write half is declared now so Phase 2 is additive.

```ts
interface MusicProvider {
  id: ProviderId                                     // 'spotify' | 'ytmusic' | 'soundcloud'
  credentialMode: 'byo' | 'central'
  auth: { authUrl(s: Session): string
          exchange(code: string): Promise<Tokens>
          refresh(t: Tokens): Promise<Tokens> }
  listLikedTracks(ctx, cursor?): Promise<Page<ProviderTrack>>
  listPlaylists(ctx, cursor?): Promise<Page<ProviderPlaylist>>
  listPlaylistTracks(ctx, id, cursor?): Promise<Page<ProviderTrack>>
  // Phase 2
  search?(ctx, q: TrackQuery, limit: number): Promise<ProviderTrack[]>
  createPlaylist?(ctx, name: string, desc?: string): Promise<string>
  addTracks?(ctx, playlistId: string, ids: string[]): Promise<void>
}
```

Adapters normalize to a canonical `Track` (`isrc`, `title`, `artists[]`, `album`, `durationMs`, `providerRefs[]`). Provider quirks stay inside the adapter — nothing above it branches on `provider.id`.

### Data model (`packages/db/schema.ts`)

- `users` — Timbre's own accounts (Auth.js v5, email + passkey). **Deliberately not Spotify-as-login**, since Spotify is BYO and may be disconnected.
- `connections` — one row per (user, provider): encrypted tokens, encrypted BYO client id/secret, scopes, status.
- `tracks` — canonical, ISRC-keyed where available.
- `provider_tracks` — (connection, provider, providerId) → `tracks.id`. The join that makes one library out of three.
- `playlists`, `playlist_tracks` — mirrored with provider ownership + position.
- `sync_runs` — per-run status, cursor, counts, errors. Makes ingest resumable.
- `match_decisions` — Phase 2; records auto-matches and user overrides so a re-run never re-asks.

Tokens and BYO secrets are encrypted at rest with AES-256-GCM (key from env/KMS, never in the DB). This is non-negotiable — Timbre stores third-party OAuth tokens *and* user-owned client secrets.

### Rate limiting and quota — a first-class component

Not an afterthought; Spotify's Feb 2026 changes make it the main engineering constraint. `packages/core/src/limiter.ts` provides a persisted per-connection token bucket:

- Spotify: batch endpoints are gone, so a 2,000-track library is ~2,000 requests. Ingest **must** be a resumable background job, not a request handler.
- Parse the 429 body's `reason` field — `QUOTA_EXCEEDED` means back off for the day; a plain rate limit means retry with `Retry-After`.
- YouTube: track unit costs (`search.list` = 100, `playlistItems.insert` = 50) against the 10k/day budget and surface remaining budget in the UI.

Ingest runs on a durable queue (`pg-boss` — Postgres-backed, no extra infrastructure), one job per (connection, resource), checkpointing its cursor into `sync_runs`.

## Build order

**Phase 0 — Foundation**
Scaffold the monorepo, Next.js app, Drizzle schema + first migration, Auth.js, `MusicProvider` interface, encryption helpers, limiter, `pg-boss`. No provider logic yet.

**Phase 1 — Connect + unified library (the MVP)**
1. **SoundCloud adapter first** — central credentials, simplest OAuth, proves the interface end to end with the fewest moving parts. Register via `sc-api-auth.mjs` (needs Artist Pro).
2. **Spotify adapter + BYO wizard** — the highest-risk UX in the app. A guided flow: create app at the Spotify dashboard → copy this exact redirect URI → paste Client ID/Secret → connect. Needs inline screenshots and a live validation step that reports precisely which part failed.
3. **YT Music adapter + `ytmusic` sidecar** — FastAPI wrapping `ytmusicapi`, BYO Google client ID/secret through the same wizard component as Spotify.
4. **Ingest jobs** — liked songs + playlists per provider, resumable, rate-limited.
5. **Unified library UI** — one virtualized list across all sources, filter by provider/artist/album, full-text search over the local mirror (so browsing costs zero API calls), per-track badges showing which services carry it, deep links out to play.

**Phase 2 — Matching + transfer**
ISRC-first matching, falling back to normalized title/artist/duration (±3s) with a confidence score. Normalization must strip `(Remastered 2011)`, `- Radio Edit`, `feat.` variants. Spotify's 10-result search cap means issuing several narrow queries rather than one broad one. Auto-accept above threshold, queue the rest for one-tap human review, persist every decision to `match_decisions`. Then one-way transfer, then scheduled two-way mirroring with conflict rules.

## Key risks

- **BYO onboarding is the product's biggest funnel risk.** Asking a user to create a developer app is a real drop-off cliff. Mitigation: make SoundCloud (zero-setup) the first-run connection so the app has value before Spotify is attempted, and treat wizard polish as a feature, not chrome.
- **Spotify BYO requires the user to hold Premium** to own a dev app. Free-tier users cannot connect Spotify at all. This must be stated up front, not discovered at step 4.
- **`ytmusicapi` is unofficial** and can break on any YouTube web change. Isolating it in one service keeps the blast radius to one deployable; pin the version and treat YT Music as the provider most likely to need a hotfix.
- **Do not evade Spotify's user cap by rotating the 25 Client IDs** a developer account now allows. It would read as circumvention and risks the whole developer account. BYO is the sanctioned path.

## Verification

Phase 0/1 are verified with real accounts — this app is nearly all third-party integration, so mocks prove very little.

1. `pnpm dev` runs `web` + `ytmusic`; `/api/health` reports both.
2. Connect all three providers with live accounts. Confirm each `connections` row holds ciphertext, not plaintext tokens.
3. Run ingest; assert Timbre's liked-song and playlist counts **match the numbers each official app displays**. This is the real pass/fail for the MVP.
4. Kill the process mid-ingest and restart — it must resume from `sync_runs`, not restart.
5. Force a 429 (env-flagged fake limiter) and confirm backoff, and that `QUOTA_EXCEEDED` halts rather than hot-retries.
6. Expire a token; confirm silent refresh, and that a revoked connection surfaces a re-auth prompt instead of a crash.
7. Unit tests where logic is genuinely ours and worth pinning: normalization, matcher scoring, limiter accounting.

## Sources

- [Spotify — Updating the Criteria for Web API Extended Access](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)
- [Spotify — February 2026 Web API Dev Mode Changes: Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify — Web API quota updates for Development Mode (Jul 2026)](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)
- [Spotify — Rate Limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [SoundCloud — API Credentials from Your Terminal, and OpenAPI on GitHub](https://developers.soundcloud.com/blog/api-credentials-cli-openapi-github/)
- [SoundCloud — Get an API key](https://developers.soundcloud.com/docs/api/register-app)
- [ytmusicapi — GitHub](https://github.com/sigma67/ytmusicapi)
- [ytmusicapi — OAuth authentication](https://ytmusicapi.readthedocs.io/en/stable/setup/oauth.html)
