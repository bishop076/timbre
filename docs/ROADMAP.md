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
| [B — Playback](#phase-b--playback) | **The product works.** One queue, real audio | 28/33 | 🔨 **in progress** |
| [C — Playlists, in the browser](#phase-c--playlists-in-the-browser) | Your own lists, saved locally | 12/13 | ✅ complete |
| [D — Polish and launch](#phase-d--polish-and-launch) | Other people can use it | 12/20 | 🔨 **in progress** |
| [Blocked](#blocked) | Gated by other people | — | 🎲 see [BLOCKED.md](BLOCKED.md) |

**The product works.** You can search across three sources, click a song, hear it,
build and reorder a queue, and save lists that survive a refresh. What is left in
B is the handoff gap; what is left overall is **Phase D — making it fit for
someone other than the person who built it.**

Two of D's correctness items were promoted out of "polish" and are done, because
they are what stops a public link failing on contact: search results are cached
and every public route is rate-limited. Apple allows ~20 requests/minute *per IP*
and every visitor shares the deployment's one address, so without both, a handful
of simultaneous readers exhaust the minute's budget and search goes quiet for
everyone.

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

*The milestone. One queue, real audio.* — 28/33 🔨

**The mechanism works, and the queue is now editable.** Search a song, click it,
hear it; add more, reorder them, drop the ones you did not want. What is left is
the handoff gap and the two items other people gate.

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

### B.3 Queue and controller — 11/13
- [x] Queue holds **songs with a set of sources**, not source-tracks
- [x] Controller routes transport to whichever player owns the current song
- [x] **Exactly one player audible** — enforced by mounting only the active player,
      so silence is structural rather than a discipline
- [x] Best controllable source picked automatically
- [x] Auto-advance on track end; next / previous
- [x] A failing source falls through, then explains itself
- [x] **Shuffle and repeat** — one pass per shuffle, so nothing replays while
      another song goes unheard; repeat cycles off → all → one
- [x] **Add to queue** — on song tiles and on both list rows, beside "add to
      playlist". Queued songs show a tick rather than hiding the control, since
      the queue dedupes by id and a silent no-op reads as a broken button
- [x] **Clear** the queued songs, keeping what is playing
- [x] **Reorder and remove**, from the expanded queue. Up/down buttons rather
      than drag: the queue is the one list genuinely edited on a phone, and
      buttons serve touch, keyboard and screen readers with one implementation
- [x] Index arithmetic extracted to `app/player/queue-ops.ts` and unit-tested —
      playback is tracked by *position*, so every edit has to carry the playhead
      with it or the highlighted row drifts from the audible song
- [ ] **Play next** — insert after the current song. Needs a UI decision first:
      a second button on every row, or a menu holding both queue actions
- [ ] Pre-mount the next song's player to shorten the handoff gap
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

## Phase C — Playlists, in the browser

*Your own lists, saved — on your machine.* — 12/13 ✅ effectively complete

> **The accounts half of this phase was deleted, not finished.** Postgres, Auth.js,
> the magic-link flow and every server-side playlist route are gone. The reason is
> hosting: server-side lists need an always-on database, an account system to own
> them, and an SMTP provider to deliver sign-in links — and the free tiers for that
> last one either cap at your own address or need a domain you have to buy. Local
> playlists need none of it, which is what makes [DEPLOY.md](DEPLOY.md) two
> services and no credit card.
>
> The trade is stated wherever lists appear: they do not follow you to another
> device, and clearing site data loses them. **Export is the mitigation**, which is
> why it is a first-class feature rather than a nicety.

- [x] Playlists live in `localStorage` — `app/playlists/store.ts`. A list stores
      **whole songs**, not references: the normalised tables it replaced existed
      so one match could be shared between users, and with one browser and one
      person there is nobody to share with
- [x] Create, rename and delete, all from the UI
- [x] Add to a playlist from search results and from an artist page
- [x] Play a playlist straight into the queue, in order
- [x] Remove and reorder tracks within a list
- [x] `/library` route, because the rail is desktop-only and a phone would
      otherwise have no way back to a saved playlist
- [x] **Export and import as JSON** — the escape hatch that makes local storage
      an acceptable trade rather than a data-loss bug
- [x] Anonymous by construction: there is no account to be without
- [ ] Re-resolve a track if its source link dies
- [ ] ~~Account settings, deletion, sign-up migration~~ — **moot.** No accounts
      exist, and nothing is stored server-side to settle, migrate or delete
- [ ] Export as CSV — JSON round-trips; CSV would only be for spreadsheets

### Artist pages ✅

*Timbre's own page, assembled from other people's catalogues.*

- [x] `/artist/[name]` — Deezer supplies the picture and follower count, the
      search merger supplies the playable songs. Neither could render it alone
- [x] Keyed by **name, not a source's artist id**: an id would bind the route to
      whichever service supplied it, and no single service owns this page
- [x] Still no biography — no keyless source publishes one, and inventing prose
      about a real musician is a fabrication rather than a design choice
- [ ] Linked from song rows and the now-playing panel (the page exists; nothing
      navigates to it yet)
- [ ] Albums — deferred deliberately: the reachable sources disagree on album
      membership, and stitching one together would invent a discography

---

## Phase D — Polish and launch

*Other people can use it.* — 12/20 🔨

### Experience
- [ ] Mobile layout
- [ ] **Test mobile Safari specifically** — autoplay restrictions are worst there
- [x] **Keyboard shortcuts** — `/` focuses search, Escape leaves it, Space
      toggles, ←/→ skip tracks, ↑/↓ move volume. Not a convenience: media keys
      reach the *iframe*, not Timbre's queue, so this was the only keyboard
      route to next/previous. What must not be intercepted lives in
      `app/player/transport-keys.ts` and is unit-tested — duck-typed rather
      than `instanceof HTMLElement`, since an element inside one of the app's
      iframes belongs to another realm and would wrongly pass
- [ ] Accessible player controls, focus management, screen-reader labels
- [x] **Themes** — three, chosen on `/profile` and stored per browser:
      **Album** (dark, ramp built from the current cover), **Pastel** (light and
      soft), and **One colour** (a fixed hue artwork never moves, on either
      ground — including **white** and **dark** neutrals with no hue at all).
      The ramp is a pure function in `app/theme/palette.ts` with 16 tests,
      including that no label ever lands within 40% lightness of the surface
      behind it — the failure that otherwise only shows up when the wrong album
      happens to play. A blocking inline script in `layout.tsx` stamps the
      ground before first paint, so there is no flash; the palette stays in CSS
      so nothing is duplicated between the two
- [x] **Toned the album ramp down.** Surfaces took ~85% of the cover's
      saturation, so a strong sleeve turned the ground, the panels *and* the
      labels the same loud colour — nowhere for the eye to rest, and the artwork
      competing with its own backdrop. Surfaces now take `SURFACE_TINT` (0.34),
      labels are near-neutral, the ground is darker (10% → 7% lightness) and the
      blurred-cover wash dropped from `saturate(2.1)`/0.55 to
      `saturate(1.35)`/0.36. The **accent keeps full saturation** — that is
      where the colour is meant to arrive, and holding it there is what lets
      everything else recede
- [x] **Softened the edge on light grounds.** The near-black 2px border plus a
      solid offset shadow reads as depth over near-black, where there is no
      contrast to spend; over a pale surface the identical values read as a
      heavy outline drawn around every panel. Light grounds now use a mid-grey
      ink (~44% lightness) and a **translucent** shadow, since a solid one sits
      directly behind the border and doubles the apparent weight of the edge.
      Dark keeps its hard edge — tested both ways so neither drifts
- [x] **`/profile` reachable on a phone.** It held the theme picker and nothing
      below `lg` linked to it — the rail that carries it is `lg:flex`, so the
      page existed and could not be opened. The bottom nav now has a third
      entry wearing the reader's own avatar
- [ ] Loading skeletons over spinners
- [ ] Clear messaging when a track can't play, and why

### Correctness
- [x] **Cache search results** — `lib/cache.ts`. Two-minute TTL, and concurrent
      identical misses share **one** upstream call, which is the case that
      matters: without it, ten people searching the same song at once produce
      ten requests that all write the same answer. Measured 3.5s cold → 0.08s
      warm
- [x] **Rate-limit Timbre's own endpoints** — `lib/rate-limit.ts`, 60/min per
      client on every public route, with `Retry-After` on refusal. Both this and
      the cache are per instance, since there is no shared store; they are
      back-pressure against accidents, not access control
- [x] **CI** — `.github/workflows/ci.yml`. Two jobs, because the sidecar rides
      an unofficial API and can break on a day nothing in the web app changed;
      separate jobs name which half is wrong before anyone opens a log
- [x] **Handle every source failing at once.** `searchAll`/`chartAll` now report
      `attempted` alongside `failures`, because without it "every source is
      down" and "every source answered, none had this song" are the same
      observation — no tracks and some failures — and they need opposite
      messages. Previously a total outage stacked three *"X is unavailable —
      showing everything else"* banners above *"Nothing found for …"*: a promise
      of results that did not exist, followed by blaming the query for their
      absence. Now it is one alert saying the fault is ours. The home page says
      the same for charts instead of rendering an empty shelf under a heading,
      which reads as a finished page with nothing to say
- [ ] Offline behaviour
- [ ] Error tracking and structured logging

### Honesty
- [x] **`/about`** — what Timbre is, what it deliberately does not do, and why
- [x] **The mobile background-play limit, stated up front** and near the top of
      `/about` rather than buried. A reader who meets it mid-song concludes the
      app is broken; one told first knows it is the shape of the thing
- [x] **"Not affiliated"** — naming four companies invites the assumption that
      one of them endorsed this, so it says otherwise plainly
- [x] **Attribution and links back to each source**, with what each one actually
      contributes. A term of use for every service embedded here, not a courtesy
- [x] **Privacy policy** at `/privacy` — **required** by YouTube's API Services
      Terms for any client embedding their player, so this is a condition of
      using the player at all. Short, because the truthful version is short; the
      care went into saying that the *embedded services* can see the reader and
      that Timbre cannot speak for them. "We collect nothing" alone would be
      true and misleading
- [x] Both reachable on **every** viewport — `shell/site-links.tsx` renders in
      the rail on desktop and at the foot of the library on phones, since the
      rail is `lg:flex` and a policy nothing links to discharges nothing
- [ ] Terms of service — **left open deliberately.** Unlike the privacy policy,
      which describes what the code does, this is a legal document making
      commitments; it wants a human author before any public launch

### Launch
- [ ] **Spike first: deploy the sidecar alone and curl `/search` from it.** Ten
      minutes, and it gates every other hosting decision — see [DEPLOY.md](DEPLOY.md).
      Record the result in [BLOCKED.md](BLOCKED.md) either way
- [ ] Hosting: Vercel hobby + **Neon** free Postgres. Not Render's free Postgres —
      it is deleted 30 days after creation
- [ ] Deploy the Python sidecar to **Render free** (~1 min cold start after 15 min
      idle; 750 instance-hrs/month covers one always-warm service, a month being
      730 hours). *Not* Fly.io — its free tier ended in 2024
- [ ] Rate-limit and cache before inviting anyone: Apple allows ~20 req/min **per
      IP**, and every visitor shares the deployment's one egress IP
- [ ] Re-read every provider's ToS immediately before launch
- [ ] Decide hosted vs. self-host given `ytmusicapi` is unofficial. Note self-host
      also buys a residential IP, which is the safer side of YouTube's datacenter
      blocking — though search is not the part that gets blocked (see BLOCKED.md)

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
