# Timbre — Implementation Plan

> **A music player for people who don't pay for streaming.**
> One search, one queue, across YouTube Music and SoundCloud — with Spotify alongside.

**Status:** Phase 0 foundation complete · Phase A (search) next
**Last updated:** 14 August 2026

---

## Contents

1. [How we got here](#1-how-we-got-here)
2. [What Timbre is](#2-what-timbre-is)
3. [Rules that shape the design](#3-rules-that-shape-the-design)
4. [Architecture](#4-architecture)
5. [Build order](#5-build-order)
6. [Risks](#6-risks)
7. [Verification](#7-verification)
8. [Decision log](#8-decision-log)
9. [Sources](#9-sources)

---

## 1. How we got here

Timbre started as "an app that connects Spotify, YouTube Music and SoundCloud." Research dismantled that shape in four steps, and the wreckage pointed at a better product.

| # | Finding | Effect |
| :-- | :--- | :--- |
| 1 | Spotify Development Mode is capped at **5 users** (Feb 2026); extended quota needs a registered business and **250k MAU** | Any product requiring users to connect Spotify accounts can never go public |
| 2 | Spotify **Premium is required to own a dev app**, explicitly including hobby projects | Spotify-connected features are neither buildable nor testable without paying |
| 3 | Spotify Developer Terms **§IV.2**: *"Do not create any product or service which is integrated with streams or content from another service"* | A unified player blending Spotify audio with other services is categorically prohibited |
| 4 | YouTube Developer Policies forbid **isolating audio from video**, **background play**, and **hiding the player** | YouTube playback must stay visible and foregrounded |

**Every blocker involves Spotify. Nothing free and legal does.**

> ### The reframe
>
> Spotify, Apple and Tidal already serve people who pay. **Nobody builds well for people who don't.**
>
> YouTube Music's free tier plus SoundCloud is an enormous catalogue — remixes, DJ sets, live rips, indie uploads and unofficial releases that are **not on Spotify at all** — and there is no good unified player for it.
>
> The constraint becomes the positioning.

---

## 2. What Timbre is

- **Search** one box → results from YouTube Music (full catalogue, free, no API key)
- **Play** one continuous queue mixing YouTube Music and SoundCloud
- **Save** your own Timbre playlists that reference source tracks
- **See** where else a song lives — Spotify, Deezer, Apple — and hand off

### Spotify participates — as a panel, not a queue member

The **official Spotify embed** (`open.spotify.com/embed/track/{id}`) needs no API key, no dev app, and no Premium. A listener signed into Spotify — **a free account is enough** — hears full-length tracks. Anonymous visitors hear a 30-second preview.

The embed does **not support autoplay or programmatic play**; the user must click it. Spotify therefore *cannot* be auto-advanced through a queue even if we wanted it to be — the technical reality and the legal one agree.

So: when the current song exists on Spotify, Timbre shows a Spotify embed panel. Clearly attributed, separately controlled, never blended into the queue.

> **Terms caveat.** Spotify's Widget Terms state that using Embeds means accepting the Developer Terms, so §IV.2 still applies in some form. Embedding Spotify beside other services with separate attributed players is long-established practice. Blending Spotify audio into a mixed queue is clearly prohibited. This design stays on the safe side — but read the [Widget Terms](https://developer.spotify.com/documentation/embeds/terms) before any public launch.

### What Timbre is not

- Not a host. No audio is stored, proxied or re-encoded. Every stream comes from its own service's player.
- Not a downloader. Ever.
- Not a Spotify client. Spotify content plays in Spotify's own embed, or not at all.

---

## 3. Rules that shape the design

Design inputs, not preferences. Breaking these loses API access.

| Rule | Source | Consequence |
| :--- | :--- | :--- |
| Player stays **visible**, never hidden or obscured | YouTube | The player area shows the real iframe; Timbre chrome sits *around* it |
| **No audio isolation** from video | YouTube | Never strip audio or fake an audio-only UI over a hidden video |
| **No engineered background play** | YouTube | Never work around the iframe's own backgrounding behaviour. See the note below on what actually happens. |
| Must **add independent value**, not clone YouTube | YouTube | Cross-source search, unified queue and playlists are that value |
| **No blending Spotify into a mixed queue** | Spotify §IV.2 | Embed is a separate panel; never auto-advance into it, never overlap it with other audio |

---

## 4. Architecture

The Phase 0 monorepo stands. What changes, by package:

### `packages/core` — keep almost entirely

`parseTitle`, `dedupeKey`, `normalizeArtists` and `durationsMatch` become **the heart of the product**: merging one song across sources *is* the matching problem this code already solves. `RateLimiter` and `classify429` still apply — Apple's public API allows only 20 requests/minute per IP. `crypto.ts` stays for later.

### `packages/providers` — reshape

From library-read to search-and-resolve:

```ts
interface SearchProvider {
  id: SourceId                    // 'ytmusic' | 'soundcloud' | 'deezer' | 'apple' | 'spotify'
  playable: boolean               // in-app playback, or link-out only?
  search(query: string, limit: number): Promise<SourceTrack[]>
  resolve?(url: string): Promise<SourceTrack | null>   // paste-a-link support
}
```

### `packages/db` — simplify

Drop the library-mirror tables (`connections`, `sync_runs`, `library_items`). Repurpose `tracks` as a resolved-track cache and `playlists`/`playlist_tracks` as **Timbre's own** playlists. Keep the Auth.js tables — accounts exist so playlists persist. Keep `rate_buckets`. This is a fresh migration; the existing one has only ever run locally.

### `apps/ytmusic` — simpler than planned

`YTMusic()` **with no credentials** supports search. No OAuth, no per-user tokens, no BYO wizard. The existing 501 stubs become unauthenticated search and resolve routes.

### `apps/web` — the real work

The player orchestration layer is the new core:

- One Timbre queue holding **songs**, not source-tracks (see below)
- A controller routing play/pause/seek/volume to whichever embedded player owns the current song
- YouTube IFrame Player API and SoundCloud Widget API both mounted; exactly one audible
- Pre-mount the next song's player while the current one plays, to shorten the gap

#### The queue holds songs, not source-tracks

This is the design decision the whole player rests on, and it is only possible because the matcher already unifies a song across sources.

A queue entry is a **song** with a set of sources:

```
♪ Redbone — Childish Gambino
  sources:  ytmusic ▶ · spotify ▶ · deezer ↗
  playing:  ytmusic
```

When the entry comes up, the controller plays it from the best **programmatically controllable** source — YouTube Music, then SoundCloud. Spotify appears beside it as an alternative the user may click.

The result is genuinely mixed-source continuous playback: a YouTube Music track, then a SoundCloud DJ set, then another YouTube Music track, auto-advancing with no interaction. Because the user clicked play once to start, browsers permit the subsequent automatic plays.

**Source selection: best available, with an override.**
Default order is YouTube Music → SoundCloud, chosen automatically. A user preference can reorder it globally, and a per-song manual switch is remembered for that song.

**Spotify-only songs pause the queue.**
If a song exists *only* on Spotify, it cannot be auto-started. The queue **stops on that entry** and shows the Spotify player with a "tap to play" prompt; when the user finishes, the queue resumes. It is never silently skipped — a song someone deliberately queued should not vanish without explanation.

> **Honesty about "seamless".** Handing off between a YouTube iframe and a SoundCloud widget will always have a perceptible gap. It can be minimised, not eliminated. Browser autoplay policy means playback starts from a user gesture, and mobile Safari is materially worse. Promise *continuous*, not *gapless*.

#### Background playback: desktop yes, mobile no

Worth stating precisely, because it is easy to get wrong in both directions.

The web platform handles background audio fine — an `<audio>` element plus the MediaSession API gives lock-screen controls and keeps playing. But **Timbre does not own the audio element**; the audio lives inside YouTube's or SoundCloud's iframe. That changes what is possible:

| | Desktop | Mobile |
| :--- | :--- | :--- |
| Background tab | ✅ plays, exactly like youtube.com or Spotify's web player | ❌ YouTube's iframe pauses |
| Screen locked | — | ❌ stops |
| Lock-screen metadata / controls | — | ❌ MediaSession can only be set from inside the iframe |
| Keyboard media keys | ⚠️ control the iframe, not Timbre's queue | — |

**On desktop this is a non-issue.** Timbre behaves identically to the services' own web players.

**On mobile, music stops when the screen locks**, and there is no legitimate way around it — background play on mobile is precisely the feature YouTube Premium sells. Do not engineer around it; say so on the landing page instead.

Consequence for the UI: provide keyboard shortcuts on the page for next/previous, since media keys will reach the iframe rather than Timbre's queue.

---

## 5. Build order

**Phase A — Search.** Unauthenticated `ytmusicapi` search in the sidecar → `YtMusicProvider` → free Deezer and Apple metadata (no keys) to show where else a song lives → result merging through the existing matcher → search UI.

**Phase B — Playback.** Compliant visible YouTube IFrame player → SoundCloud widget by URL → queue and controller → transport controls → cross-source handoff → Spotify embed panel.

**Phase C — Accounts and playlists.** Magic-link sign-in (already wired) → create/edit Timbre playlists → add from search → reorder → persistence.

**Phase D — Polish and launch.** Mobile behaviour, keyboard control, empty and error states, an honest landing page, free-tier hosting.

Full task breakdown: [ROADMAP.md](ROADMAP.md).

---

## 6. Risks

| Risk | Mitigation |
| :--- | :--- |
| **`ytmusicapi` is unofficial** and can break on any YouTube web change — and it is now the primary source, not a secondary one | Pinned to a minor range, isolated in one deployable. Accept that Timbre's core source is a moving target and budget for maintenance. |
| **Cross-source handoff feels janky** | Pre-mount the next player; design the UI so a short gap reads as intentional rather than broken. Never claim gapless. |
| **Mobile autoplay restrictions**, iOS Safari especially | Test there early, not at the end. Accept that auto-advance may require a tap on some platforms. |
| **YouTube policy compliance is subjective** — "adds independent value" is a judgement call | Keep the player genuinely visible, never isolate audio, never enable background play. Cross-source search is the independent value. |
| **SoundCloud search stays gated indefinitely** | v1 ships with URL-resolve only. Request access early; it drops into the same interface if it ever lands. |

---

## 7. Verification

- `pnpm typecheck` and `pnpm test` stay clean; the matcher gains fixtures for real cross-source pairs
- Search a well-known song; the YouTube Music result is correct and playable
- A song on several services merges into **one** result row, not duplicates
- A queue mixing YouTube Music and SoundCloud hands off correctly, with only ever one player audible
- **Compliance check:** the YouTube player is genuinely visible during playback
- The Spotify embed appears as its own panel, plays a full track when signed into a **free** Spotify account, and is never auto-started by Timbre
- Mobile Safari specifically, where autoplay restrictions bite hardest

---

## 8. Decision log

**Pivoted from library-sync to a player** — the original product required users to connect Spotify accounts, which the 5-user cap makes impossible to ship publicly. See §1.

**Spotify is an embed panel, not a queue member** — its embed cannot be started programmatically, and §IV.2 prohibits blending its audio into a mixed player. Both point to the same design.

**YouTube Music is the primary source, not a fallback** — it is the only one that is free, keyless, and complete in both search and playback.

**`provider_tracks` was global, keyed `(provider, provider_id)`** — carried over as the resolved-track cache; the reasoning (one row per source track regardless of how many users see it) still holds.

**Normalization preserves variants** — `(Remastered 2011)` is stripped as noise; `(Live)`, `(Acoustic)` and `- Remix` are kept and compared. On a service like SoundCloud, where remixes *are* the catalogue, collapsing them would be catastrophic.

> ### ⚠️ Deferred issue
> `match_decisions_scope_idx` is unique over a nullable `user_id`, and Postgres treats NULLs as distinct — so it does not prevent duplicate global rows. The table is unused. Fix with `NULLS NOT DISTINCT` or two partial indexes if match persistence is ever added.

---

## 9. Sources

**Terms and policies**
- [Spotify Developer Terms](https://developer.spotify.com/terms) — §IV.2
- [Spotify Widget/Embed Terms of Use](https://developer.spotify.com/documentation/embeds/terms)
- [YouTube API Services — Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use)

**Access limits**
- [Spotify — Feb 2026 Dev Mode Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify — Updating the Criteria for Extended Access](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)
- [SoundCloud — Get an API key](https://developers.soundcloud.com/docs/api/register-app)

**Technical**
- [ytmusicapi](https://github.com/sigma67/ytmusicapi) — unauthenticated search supported
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget) · [oEmbed](https://developers.soundcloud.com/docs/oembed)
- [Deezer API](https://developers.deezer.com) — public catalogue needs no auth
