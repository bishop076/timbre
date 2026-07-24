# Timbre — Roadmap

Every task from here to launch. **Nothing on this list requires paying for anything.**

**Legend:** ✅ done · ⬜ not started · 🎲 needs approval we can't guarantee
**Effort:** `S` hours · `M` a day or two · `L` several days

---

## At a glance

| Phase | Outcome | Tasks | Status |
| :--- | :--- | :--- | :--- |
| [0 — Foundation](#phase-0--foundation) | The app runs, empty | 33/33 | ✅ complete |
| [A — Search](#phase-a--search) | Type a song, see it across sources | 0/24 | ⬜ **next** |
| [B — Playback](#phase-b--playback) | **The product works.** One queue, real audio | 0/31 | ⬜ |
| [C — Accounts and playlists](#phase-c--accounts-and-playlists) | Your own lists, saved | 0/16 | ⬜ |
| [D — Polish and launch](#phase-d--polish-and-launch) | Other people can use it | 0/23 | ⬜ |
| [Deferred](#deferred) | Blocked on things outside our control | — | 🎲 |

**Phase B is the milestone that matters.** Search alone is a lookup tool; search plus playback is the product.

---

## Source reality

What each source can actually do, and what it costs. This drives everything below.

| Source | Search | Play in Timbre | Cost |
| :--- | :--- | :--- | :--- |
| **YouTube Music** | ✅ free, no key (`ytmusicapi` unauthenticated) | ✅ IFrame Player API, must stay visible | £0 |
| **SoundCloud** | 🎲 gated — Artist Pro + paused registration | ✅ **Widget/oEmbed, no key needed** | £0 to play |
| **Spotify** | ✅ free catalogue search via client credentials¹ | ⚠️ embed panel only — full tracks for **free** logged-in accounts | £0 |
| **Deezer** | ✅ free, no auth | ↗ link out | £0 |
| **Apple / iTunes** | ✅ free, **no key at all** (20 req/min per IP) | ↗ link out, 30s previews allowed | £0 |

¹ Spotify *search* needs a dev app, which needs Premium. Skip it initially — Deezer and Apple cover "where else does this song live" for free. Add Spotify search later if a Premium trial happens.

---

## Phase 0 — Foundation

*Complete.* — 33/33 ✅

<details>
<summary>Expand completed work</summary>

- [x] pnpm monorepo: `apps/web`, `apps/ytmusic`, `packages/{core,db,providers}`
- [x] Next.js 16 (App Router, TypeScript, Tailwind 4)
- [x] Single root `.env` loaded via `dotenv-cli`; Docker Postgres 18 + Mailpit on loopback
- [x] `@timbre/core`: canonical models, AES-256-GCM crypto, token-bucket limiter, `classify429`, normalization with variant preservation, 23 unit tests
- [x] `@timbre/db`: 14-table Drizzle schema, Auth.js tables, Postgres bucket store, HMR-safe pooling, migration applied
- [x] `@timbre/providers`: provider interface, registry, `paginate`
- [x] `apps/ytmusic`: FastAPI, stateless, constant-time shared-secret guard, `/health`
- [x] `apps/web`: zod-validated env, Auth.js v5 lazy init, `pg-boss`, `/api/health`, `proxy.ts`
- [x] Verified: build and typecheck clean, health green and correctly degraded, all services on `127.0.0.1`
- [x] 13 commits pushed to a private GitHub repo

</details>

---

## Phase A — Search

*Type a song, see every source that has it, merged into one row.* — 0/24

### A.1 Sidecar: unauthenticated search `M`
- [ ] Replace the 501 stubs with `YTMusic()` — **no credentials**
- [ ] `POST /search` — tracks, with a configurable limit
- [ ] `POST /resolve` — a YouTube Music or YouTube URL → one track
- [ ] Return `videoId`, title, artists, album, duration, thumbnail
- [ ] Map `ytmusicapi` exceptions to typed error responses
- [ ] Drop the credential fields from request models — nothing is per-user any more
- [ ] `pytest` coverage for shapes and failure modes

### A.2 Reshape the provider interface `M`
- [ ] `SearchProvider` interface replacing the library-read `MusicProvider`
- [ ] `SourceTrack` type: canonical fields + `sourceId` + `playable` + external URL
- [ ] Registry keyed by `SourceId`
- [ ] Keep `paginate` only where a source actually paginates

### A.3 Providers `M`
- [ ] `YtMusicProvider` — calls the sidecar, normalizes to `SourceTrack`
- [ ] `DeezerProvider` — public catalogue search, no auth. **Capture ISRC** — it makes merging far more accurate
- [ ] `AppleProvider` — iTunes Search API, no key. Respect 20 req/min per IP via the existing limiter
- [ ] Verify Deezer's real rate limit by measurement, not assumption

### A.4 Result merging `L`
*The hard, valuable part — and the reason `@timbre/core` survives the pivot.*
- [ ] Merge results across sources: ISRC first, then `dedupeKey`, then title+artist+duration
- [ ] **Require variant agreement** — a remix must never merge into the original
- [ ] One row per song, carrying every source that has it
- [ ] Rank by which source can actually play
- [ ] Unit tests over real cross-source pairs, including deliberately hard ones

### A.5 Search UI `M`
- [ ] Search box with debounced input
- [ ] Result rows: artwork, title, artist, duration, source badges
- [ ] Per-source availability badges, with playable ones visually distinct
- [ ] Loading, empty and error states
- [ ] Partial results — one source failing must not blank the page

---

## Phase B — Playback

*The milestone. One queue, real audio, mixed sources.* — 0/31

### B.1 YouTube player `L`
- [ ] Mount the IFrame Player API
- [ ] **Player stays visible during playback** — compliance, not cosmetics
- [ ] Play / pause / seek / volume through the API
- [ ] React to state-change events
- [ ] Handle embed-disabled and age-restricted videos gracefully — fall back to another source
- [ ] Never isolate audio; never enable background play

### B.2 SoundCloud player `M`
- [ ] Mount the Widget API iframe
- [ ] Resolve a pasted SoundCloud URL via oEmbed — no key needed
- [ ] Transport controls and event wiring
- [ ] Handle private and geo-blocked tracks

### B.3 Queue and controller `L`
*The new core of the app.*
- [ ] Queue model holds **songs with a set of sources**, not individual source-tracks
- [ ] Controller routing transport commands to whichever player owns the current song
- [ ] **Exactly one player audible, ever** — the bug that will bite hardest
- [ ] Pick the best *controllable* source automatically: YouTube Music → SoundCloud
- [ ] Auto-advance on track end
- [ ] Pre-mount the next song's player to shorten the handoff gap
- [ ] **Spotify-only songs pause the queue** with a "tap to play" prompt, then resume — never silently skipped
- [ ] Add to queue / play next / clear
- [ ] Reorder and remove
- [ ] Shuffle and repeat
- [ ] Handle a failing source by trying the next one, then telling the user why

### B.4 Player UI `M`
- [ ] Persistent transport bar
- [ ] Now-playing with source attribution — always clear *whose* content is playing
- [ ] Progress bar and seeking
- [ ] Queue panel
- [ ] Visible-player area sized to satisfy YouTube's requirements

### B.5 Spotify embed panel `S`
- [ ] Show `open.spotify.com/embed/track/{id}` when the song exists on Spotify
- [ ] Present it as a distinct, attributed panel — **never a queue member**
- [ ] Explain that signing into Spotify (free is fine) unlocks full-length playback
- [ ] Never attempt to autostart it

### B.6 Source selection `M`
- [ ] Automatic best-available choice per song (YouTube Music → SoundCloud)
- [ ] When a source fails at playback time, fall through to the next one silently
- [ ] Manual per-song source switch, shown in the now-playing panel
- [ ] **Remember a manual switch for that song** permanently
- [ ] Global preferred-source-order setting for users who care

---

## Phase C — Accounts and playlists

*Your own lists, saved.* — 0/16

- [ ] New migration: drop `connections`, `sync_runs`, `library_items`; repurpose `tracks` as a resolved-track cache
- [ ] `playlists` / `playlist_tracks` become **Timbre's own** lists
- [ ] `/signin` page — magic link, already wired
- [ ] Honest message when no sign-in method is configured
- [ ] Create, rename, delete playlists
- [ ] Add to playlist from search results and from now-playing
- [ ] Reorder tracks
- [ ] Play a playlist straight into the queue
- [ ] Cache resolved tracks so a saved song survives a source going away
- [ ] Re-resolve a track if its source link dies
- [ ] Anonymous local queue that survives without an account
- [ ] Offer to migrate a local queue into an account on sign-up
- [ ] Account settings
- [ ] Account deletion that actually deletes
- [ ] Export playlists as JSON and CSV
- [ ] Import from pasted links

---

## Phase D — Polish and launch

*Other people can use it.* — 0/23

### Experience
- [ ] Mobile layout
- [ ] **Test mobile Safari specifically** — autoplay restrictions are worst there
- [ ] Keyboard shortcuts (space, arrows, `/` to search)
- [ ] Accessible player controls, focus management, screen-reader labels
- [ ] Dark and light themes
- [ ] Loading skeletons over spinners
- [ ] Clear messaging when a track can't play, and why

### Correctness
- [ ] Handle every source failing at once
- [ ] Offline behaviour
- [ ] Rate-limit Timbre's own endpoints
- [ ] Cache search results to cut repeat calls
- [ ] Error tracking and structured logging
- [ ] CI: typecheck, tests, build on every push

### Honesty
- [ ] Landing page stating plainly what Timbre is and is not
- [ ] **State the mobile background-play limit up front** — desktop plays in a background tab like any music site; locking a phone stops it
- [ ] "Not affiliated with any of these services" notice
- [ ] Attribution and links back to each source
- [ ] Privacy policy — what is stored, where, how long
- [ ] Terms of service

### Launch
- [ ] Hosting: Vercel hobby + Neon or Supabase free Postgres
- [ ] Deploy the Python sidecar (Fly.io free tier or similar)
- [ ] Re-read every provider's ToS immediately before launch
- [ ] Decide hosted vs. self-host given `ytmusicapi` is unofficial

---

## Deferred

Blocked on things outside our control. Fully specified so they drop in if circumstances change.

### SoundCloud search 🎲
- [ ] Submit an access request — **free, do it early**, it may sit in a queue for weeks
- [ ] If granted: `SoundCloudProvider.search()` into the same interface, nothing else changes

### Spotify catalogue search 💳
- [ ] Needs a dev app, which needs Premium. A 3-month free trial would cover building it
- [ ] Client-credentials flow only — no user OAuth, so the 5-user cap never applies
- [ ] Would replace Deezer/Apple as the "also on Spotify" signal, and improve match quality via Spotify ISRCs

### Library sync 💳
- [ ] Requires connecting user accounts. Spotify's 5-user cap makes this unshippable publicly
- [ ] Phase 0's `connections` schema, token encryption and BYO wizard design are preserved in git history if this ever becomes viable

---

## Deliberate non-goals

- **Downloading or caching audio.** Never. Timbre is a shell around other people's players.
- **Engineering around mobile background playback.** Desktop background tabs work by themselves. Mobile stops when the screen locks, and that is exactly what YouTube Premium sells — do not fight it, state it.
- **Audio-only YouTube.** Prohibited. The player stays visible.
- **Blending Spotify into the queue.** Prohibited by §IV.2, and technically impossible anyway.
- **Gapless cross-source playback.** Not achievable between separate iframe players. Promise *continuous*, not gapless.
- **Paying for developer accounts before there is a working app.** Everything above is free.
