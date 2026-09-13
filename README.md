![Timbre](docs/assets/readme-banner.png)

# Timbre

**A music player for people who don't pay for streaming.**

One search box, one queue. Free sources only, and nothing stored on a server.

Spotify, Apple and Tidal serve people who pay; nobody builds well for people who don't.
YouTube Music's free tier plus Audius is an enormous catalogue — remixes, DJ sets, live rips
and unsigned uploads that aren't on Spotify at all — with no good unified player for it.

Timbre is mostly a shell around other services' own players. **It hosts nothing.** Audio
streams from the service it belongs to, through that service's player, so ads run and
artists are paid exactly as they would be otherwise.

## What it does

**Find it**

- One search box → YouTube Music and Audius at once, merged into one row per song instead
  of four near-duplicates, with availability shown on Deezer and Apple
- Suggestions as you type, and the query lives in the URL — a search reloads and shares
- Charts fused across Deezer and Apple, plus genres, radios, editorial lists and genre mixes
- Artist and album pages, and a similar-songs panel off whatever is playing
- Paste a Spotify, YouTube or SoundCloud link and it just plays
- Live concert tapes from the Archive suggested alongside a band that allows taping
- SoundCloud catalogue search too, when the operator supplies a `client_id`

**Play it**

- A continuous queue that resolves a playable copy *at play time*, and falls through to
  another upload when one refuses to embed
- Radio carries on when the queue runs dry; reorder it, queue a song next, search within it
- Synced lyrics from LRCLIB or YouTube Music, scrolling in time
- Playback speed, a sleep timer, volume memory and keyboard transport keys
- A second tab becomes a remote for the tab that is playing, rather than fighting it
- Connect Spotify Premium and Spotify tracks play in full through its own SDK

**Keep it**

- Playlists, liked songs and history — no account, saved in your browser
- Listening stats: top songs and artists, totals, first and last play, by day and weekday
- Save someone else’s playlist or an album as your own
- Export a playlist to CSV, or back the whole profile up to one JSON file and restore it

**Make it yours**

- A theme that takes its colour from the album art, plus a pastel set and a custom one
- A profile name, avatar and banner — resized in the browser, never uploaded
- Installs as a PWA, works on a phone, and has no sign-up, no telemetry and no database

## What it deliberately doesn't do

No background playback on mobile, no audio-only YouTube, no downloading or caching, no
gapless cross-source handoff, no accounts and no server-side data. These are rules Timbre
respects rather than features it is missing.

## Running

Node 22+, pnpm 11+, Python 3.11+ and [uv](https://docs.astral.sh/uv/). No database, no
Docker, no API keys.

```bash
pnpm install && (cd apps/ytmusic && uv sync --extra dev)

pnpm dev:ytmusic    # FastAPI sidecar on :8787   ← start this first
pnpm dev            # Next.js on :3000
```

Both terminals are required: start the web app alone and it will serve pages and find
nothing. **[RUNNING.md](RUNNING.md) covers setup, the `.env` it needs, and the failure modes
worth recognising** — start there before assuming the app is broken.

## Layout

```
apps/web/        Next.js 16 — search, player orchestration, playlists
apps/ytmusic/    FastAPI + ytmusicapi — unauthenticated search, holds no secrets
packages/core/   canonical models, matching, rate limiter, error taxonomy
packages/providers/  SearchProvider interface + per-source adapters
```

There is no database. Everything a person owns lives in their own browser, which is what
makes this free to host. The matching engine in `packages/core` is the heart of it: showing
one song across several sources *is* a matching problem.

```bash
pnpm test && pnpm typecheck
```

`ytmusicapi` is unofficial and can break when YouTube changes its web client — it's pinned
and isolated in its own service, but budget for maintenance.
