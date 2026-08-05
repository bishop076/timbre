# Workstreams

Two agents are working on Timbre at once. This is who owns what, so neither
overwrites the other's file mid-edit.

**Read the first section before writing any code.** It records an architectural
change that invalidates assumptions the rest of the repo used to be built on.

---

## ⚠️ Architecture changed: there is no server-side data

*2026-08-16.* Timbre now stores **nothing** about anyone. This was a deliberate
decision driven by hosting cost — see the reasoning below — and it deleted a
large amount of code that other work may still assume exists.

| Gone | Replaced by |
| :--- | :--- |
| Postgres, `packages/db`, all migrations | nothing — no database at all |
| Auth.js, `auth.ts`, `/signin`, `/api/auth/*` | no accounts, no sign-in |
| `users` / `sessions` / `playlists` tables | `localStorage` |
| `/api/playlists`, `/api/me`, `lib/playlists.ts`, `lib/profile.ts` | client stores |
| `proxy.ts` (route protection) | nothing to protect |
| `docker-compose.yml` (Postgres + Mailpit) | no services to run |

**Why:** accounts need an SMTP provider in production to deliver magic links,
and a database that stays alive to hold an email and a session. Both cost money
or an account. Dropping them makes the app free to host on Vercel hobby with the
sidecar on a free tier, and leaves no personal data to protect.

**What this means when writing code now:**

- There is no `getDatabase()`, no `auth()`, no session, no user id from a server.
- User-owned state goes in a **client store** under `app/`, following the
  `useSyncExternalStore` idiom already used by `player/volume-store.ts`.
- `apps/web/lib/env.ts` has **two** variables. Do not add secrets to it.
- Anything a person owns must survive only in their browser, and the UI should
  say so — the phrase used throughout is *"only on this device"*.

---

## Ownership

Neither agent edits the other's files without checking they are not mid-write.

### Agent A — playback, recommendations, shell polish

```
packages/providers/**          recommend.ts, registry.ts, types.ts, ytmusic.ts, deezer.ts
apps/ytmusic/**                the Python sidecar, radio.py
apps/web/app/api/radio/        recommendation endpoint
apps/web/app/api/art/          artwork proxy
apps/web/app/artwork.tsx
apps/web/app/player/           player-context, youtube-player, soundcloud-player,
                               player-bar, add-to-queue, history-store,
                               use-artwork-accent, wavy-progress, volume*
apps/web/app/shell/            app-shell, scroll-thumb
apps/web/app/globals.css
docs/RECOMMENDATIONS.md, docs/BUGS.md
```

### Agent B — library, profile, local data, lyrics

```
apps/web/app/playlists/        local playlist store + all playlist UI
apps/web/app/profile/          local profile, avatar, images, dominant-color
apps/web/app/library/          library route
apps/web/app/playlist/[id]/    playlist detail route
apps/web/app/artist/           artist pages
apps/web/app/api/lyrics/       LRCLIB proxy
apps/web/app/api/artist/       artist lookup
apps/web/app/player/lyrics-panel.tsx
apps/web/app/player/related-panel.tsx
apps/web/app/player/panel-tabs.tsx
apps/web/lib/env.ts, lib/providers.ts
README.md, docs/ROADMAP.md, this file
```

### Shared — announce before a large edit

```
apps/web/app/icons.tsx         append new icons at the end; never reorder
apps/web/app/shell/sidebar.tsx both agents have reason to touch it
apps/web/app/search-results.tsx
apps/web/app/song-card.tsx
apps/web/app/player/now-playing.tsx
apps/web/app/types.ts
```

**Protocol for a shared file:** re-read it immediately before editing, keep the
edit as small as it can be, and run `pnpm --filter @timbre/web typecheck` after.
A build that fails on a file you did not touch usually means the other agent is
mid-write — wait and re-run rather than "fixing" it. This has now happened four
times (`artist-view`, `library-view`, `song-card`, `/profile` prerender) and
each time the file was complete a few seconds later.

### Crossings, so they are not a surprise

**`player/youtube-player.tsx` is untouched.** Agent B edited it briefly to try
to suppress YouTube's paused-state overlay, then reverted the file completely —
`git checkout` back to Agent A's committed version, no residue. Nothing in it
needs reviewing.

**Agent B fixed `player/volume.tsx`** (Agent A's file), one line. `applyFrom`
divided the pointer offset by the track's full width, but the addressable
positions run 0..width-1 — so dragging fully right produced **98** on the narrow
bar and 99 on the wide one, rendering a visually-full slider whose audio sat
under maximum. Dividing by `width - 1` maps the last pixel to 100. Keyboard
`End`, the wheel and the default were already correct; only dragging was short.

### Non-goal: hiding YouTube's paused overlay

Recorded here rather than in the player file, so that file stays Agent A's.
When paused or unstarted, the embed paints the channel name across the top and
share / "More videos" / the logo across the bottom. **It cannot be removed:**

- No player parameter disables it. `controls: 0` removes the control bar and
  `pointer-events: none` removes the hover overlay; the paused state is painted
  regardless. `modestbranding` was retired in 2024 and never covered it.
- It renders inside a cross-origin iframe, so it cannot be styled or scripted
  from Timbre's side. That is the same-origin policy, not an API gap.
- Overscanning the iframe to push it out of view was tried and does not hold:
  the chrome reflows with player size and with the video's title length, so a
  crop tuned at one size misses at another while already eating the picture.
- Covering it would work and is exactly what YouTube's Developer Policies
  forbid. Timbre's position depends on respecting that, so it is closed on
  purpose.

Captions (`[Music]`) are a separate subsystem and *are* suppressible via
`cc_load_policy` plus `unloadModule("captions")` on ready — worth doing if
Agent A wants it, but it was reverted with the rest.

---

## Current state

**Agent A** has landed cross-source recommendation fusion (`/api/radio`,
`recommend.ts`, four ranked lists, RRF + consensus scoring), the artwork proxy,
playback history, queue ergonomics (shuffle, repeat, add-to-queue, clear) and a
run of shell/visual fixes.

**Agent B** has landed browser-local playlists (create, rename, delete, reorder,
remove, export/import), a local profile with avatar and banner stored in
IndexedDB, artist pages, and a tabbed expanded-player panel — **Up next ·
Lyrics · Related** — with synced lyrics from LRCLIB.

### Deliberate absences, so they are not "fixed" by mistake

- **No Comments tab.** They belong to the upload rather than the recording, need
  a keyed API, and would differ per fallback copy. Stated in `panel-tabs.tsx`.
- **No cross-device sync.** It would require the server-side data that was just
  removed. Export/import is the answer.
- **No public profiles.** Nothing is shared between people; there is no "other
  person" to show one to.
