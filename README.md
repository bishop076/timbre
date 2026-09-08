![Timbre — all your music, one search](docs/assets/readme-banner.png)

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

- **Search** one box → YouTube Music and Audius, merged with availability on Deezer and Apple
- **Play** a continuous queue that resolves a playable copy at play time, and falls through
  to another upload when one refuses to embed
- **Explore** charts fused across Deezer and Apple, plus genres, radios and editorial lists
- **Lyrics** from LRCLIB, **playlists** and **a profile** — saved in your browser, no account

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
