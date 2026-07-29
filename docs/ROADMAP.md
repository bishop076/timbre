# Timbre — Roadmap

Every task from here to launch. **Nothing on this list requires paying for anything.**

**Legend:** ✅ done · ⬜ not started · 🎲 needs approval we can't guarantee
**Effort:** `S` hours · `M` a day or two · `L` several days

---

## At a glance

| Phase | Outcome | Tasks | Status |
| :--- | :--- | :--- | :--- |
| [0 — Foundation](#phase-0--foundation) | The app runs, empty | 33/33 | ✅ complete |
| [A — Search](#phase-a--search) | Type a song, see it across sources | 24/24 | ✅ complete |
| [B — Playback](#phase-b--playback) | **The product works.** One queue, real audio | 22/31 | 🔨 **in progress** |
| [C — Accounts and playlists](#phase-c--accounts-and-playlists) | Your own lists, saved | 0/16 | ⬜ **next** |
| [D — Polish and launch](#phase-d--polish-and-launch) | Other people can use it | 0/23 | ⬜ |
| [Blocked](#blocked) | Gated by other people | — | 🎲 see [BLOCKED.md](BLOCKED.md) |

**Phase B was the milestone that mattered, and the core of it works.** You can
search across three sources, click a song, and hear it. What remains in B is queue
ergonomics — shuffle, repeat, reorder — not the mechanism.

**Three companion documents:**
[BUGS.md](BUGS.md) — defects found and fixed, and the verified non-bugs worth not
re-investigating. [BLOCKED.md](BLOCKED.md) — what other people's gates prevent, and
why SoundCloud is built but not shipped.
[RECOMMENDATIONS.md](RECOMMENDATIONS.md) — how "play something similar" works,
why it is a ranking rule rather than a trained model, and what would have to
change for that to be the wrong call.

---

## Source reality

*Verified 2026-08-15.* **Search and Play are separate systems with separate rules,
and conflating them is what makes sources look shippable when they are not.** A
source needs *both* columns green to be worth putting in the UI.

| Source | Search | Play in Timbre | Shipped |
| :--- | :--- | :--- | :--- |
| **YouTube Music** | ✅ free, no key (`ytmusicapi` unauthenticated) | ✅ IFrame Player API, must stay visible | ✅ **yes** |
| **Deezer** | ✅ free, no auth. Carries **ISRCs** | ↗ link out | ✅ yes, as identity |
| **Apple / iTunes** | ✅ free, **no key at all** (~20 req/min per IP) | ↗ link out | ✅ yes, as identity |
| **SoundCloud** | ❌ **gated** — closed registration, paid Artist Pro, weeks of review | ✅ Widget/oEmbed, **no key**, built and working | ❌ **no** — see below |
| **Spotify** | ❌ Premium mandatory since Feb 2026; extended quota needs 250k MAU | ⚠️ embed panel only, **cannot** be script-started (§IV.2) | ❌ not started |

**SoundCloud is built and deliberately not registered.** Its player is free and
verified working; its catalogue is not searchable. Without search the only way in
is pasting a URL found elsewhere — a badge almost nobody could trigger. *A source
you cannot search is not a source.* One line in `apps/web/lib/providers.ts`
re-enables it if access is ever granted.

**The root cause of both gaps:** Odesli/Songlink shut down 31 Jul 2026, removing
the last free way to map a song onto its equivalent on another service. Free
embeds are useless without knowing *which* track to embed.

Full reasoning, and what would unblock each: **[BLOCKED.md](BLOCKED.md)**.

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

*Type a song, see every source that has it, merged into one row.* — 24/24 ✅

<details>
<summary>Expand completed work</summary>

### A.1 Sidecar: unauthenticated search ✅
- [x] `YTMusic()` with **no credentials** — `apps/ytmusic/app/client.py`
- [x] `POST /search` and `POST /resolve` — `app/routes/search.py`
- [x] Flattened wire shape incl. `videoType` — `app/normalize.py`
- [x] `ytmusicapi` exceptions → typed 502s; 34 pytest cases passing

### A.2 Reshape the provider interface ✅
- [x] `SearchProvider`, `SourceTrack`, `Song`, `Playback` — `packages/providers/src/types.ts`
- [x] Registry keyed by `SourceId`, with `searchAll` / `chartAll` / `resolveUrl` — `registry.ts`

### A.3 Providers ✅
- [x] `YtMusicProvider` · `DeezerProvider` (captures **ISRC**) · `AppleProvider`
- [x] Per-source rate policies measured into `DEFAULT_POLICIES` — `packages/core/src/limiter.ts`

### A.4 Result merging ✅
- [x] ISRC first, then `dedupeKey`, then title+artist+duration — `merge.ts`
- [x] Variant agreement preserved — a remix never merges into the original
- [x] One row per song carrying every source; unit tests in `merge.test.ts`

### A.5 Search UI ✅
- [x] Debounced search box; **pasting a URL resolves instead of searching**
- [x] Result rows with artwork, duration and per-source badges
- [x] Loading, empty and error states; partial results never blank the page

</details>

---

## Phase B — Playback

*The milestone. One queue, real audio.* — 22/31 🔨

**The mechanism works.** Search a song, click it, hear it. What is left is queue
ergonomics, not plumbing.

### B.1 YouTube player ✅
- [x] IFrame Player API mounted — `apps/web/app/player/youtube-player.tsx`
- [x] **Player stays visible** and is never shrunk below **200×200** — below
      YouTube's documented minimum, playback fails with a bare "Video unavailable"
      that reads exactly like an ad blocker. See `docs/BUGS.md` B-1.
- [x] Play / pause / seek through the API; state-change events wired
- [x] Embed-disabled uploads (errors `100`/`101`/`150`) fall through to another
      upload of the same song; code `2` does not retry
- [x] Candidates ranked `OMV → UGC → ATV`, since art tracks are the barred class
- [x] Audio never isolated; no background play

### B.2 SoundCloud player 🎲 **built, not shipped**
- [x] Widget API iframe, transport controls, event wiring
- [x] Resolve a pasted URL via oEmbed — no key needed
- [x] Private / geo-blocked / embed-disabled tracks degrade instead of throwing
- [ ] **Not registered.** Its catalogue is not searchable, so there is no way in.
      See [BLOCKED.md](BLOCKED.md).

### B.3 Queue and controller — 6/11
- [x] Queue holds **songs with a set of sources**, not source-tracks
- [x] Controller routes transport to whichever player owns the current song
- [x] **Exactly one player audible** — enforced by mounting only the active player,
      so silence is structural rather than a discipline
- [x] Best controllable source picked automatically
- [x] Auto-advance on track end; next / previous
- [x] A failing source falls through, then explains itself
- [ ] Pre-mount the next song's player to shorten the handoff gap
- [ ] Add to queue / play next / clear
- [ ] Reorder and remove
- [ ] Shuffle and repeat
- [ ] Spotify-only songs pause the queue with a "tap to play" prompt

### B.4 Player UI ✅
- [x] Persistent transport bar — `app/shell/player-bar.tsx`
- [x] Source attribution reflects the **actual** playing source, not a hardcoded
      label — a terms requirement for every service involved
- [x] Progress bar and seeking; queue panel
- [x] Player area sized to satisfy YouTube's minimum

### B.5 Spotify embed panel ⬜ deferred — [BLOCKED.md](BLOCKED.md)
- [ ] `open.spotify.com/embed/track/{id}` as a distinct attributed panel
- [ ] **Never a queue member** — its embed exposes no play API, and §IV.2 forbids
      blending. The technical and legal limits agree.
- [ ] Blocked on obtaining a track id, which is no longer free

### B.6 Source selection — 2/5
- [x] Automatic best-available choice per song
- [x] Silent fall-through when a source fails at playback time
- [ ] Manual per-song source switch in the now-playing panel
- [ ] Remember a manual switch for that song
- [ ] Global preferred-source-order setting

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

## Blocked

Gated by other people. **Full reasoning, evidence and what would unblock each:
[BLOCKED.md](BLOCKED.md)** — kept there so it is decided once rather than
re-litigated here.

| What | Why | Unblocked by |
| :--- | :--- | :--- |
| **SoundCloud search** | Closed registration, paid Artist Pro, weeks of review | Approval → one line in `lib/providers.ts` |
| **SoundCloud via `client_id`** | Works, but forbidden by their terms — and it killed Auryo | *Declined, deliberately* |
| **Spotify search** | Premium mandatory since Feb 2026; extended quota needs 250k MAU | Paying, which is a standing non-goal |
| **Spotify embed panel** | Needs a track id that is no longer obtainable free | Cross-service discovery returning |
| **Cross-service discovery** | Odesli shut down 31 Jul 2026 (`410 Gone`) | A free ISRC → service-URL resolver existing again |
| **Library sync** | Requires user accounts; Spotify's 5-user cap makes it unshippable | Not viable at any realistic scale |
| **Personalised recommendations (trained)** | No candidate set Timbre can enumerate, no item features, no users | Nothing realistic — see [RECOMMENDATIONS.md](RECOMMENDATIONS.md). Blended service lists ship instead |

Phase 0's `connections` schema, token encryption and BYO wizard survive in git
history if library sync ever becomes possible.

---

## Deliberate non-goals

- **Downloading or caching audio.** Never. Timbre is a shell around other people's players.
- **Engineering around mobile background playback.** Desktop background tabs work by themselves. Mobile stops when the screen locks, and that is exactly what YouTube Premium sells — do not fight it, state it.
- **Audio-only YouTube.** Prohibited. The player stays visible.
- **Blending Spotify into the queue.** Prohibited by §IV.2, and technically impossible anyway.
- **Gapless cross-source playback.** Not achievable between separate iframe players. Promise *continuous*, not gapless.
- **Paying for developer accounts before there is a working app.** Everything above is free.
