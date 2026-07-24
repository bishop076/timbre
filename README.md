# Timbre

**A music player for people who don't pay for streaming.**

One search box, one queue, across YouTube Music and SoundCloud — with Spotify alongside where it's allowed.

## Why this exists

Spotify, Apple and Tidal serve people who pay. Nobody builds well for people who don't.

YouTube Music's free tier plus SoundCloud is an enormous catalogue — remixes, DJ sets, live rips, indie uploads and unofficial releases that **aren't on Spotify at all** — and there's no good unified player for it.

Timbre is a shell around other services' own players. **It hosts nothing.** Audio always streams from the service it belongs to, through that service's official player, so ads run and artists are paid exactly as they would be otherwise. What belongs to Spotify stays in Spotify.

The full reasoning — including why the original "connect all three accounts" idea is impossible — is in [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Search** one box → results from YouTube Music, merged with availability on Deezer and Apple
- **Play** one continuous queue mixing YouTube Music and SoundCloud
- **Spotify panel** — the official embed plays **full tracks for free Spotify accounts** when signed in
- **Playlists** of your own, referencing source tracks

## What it deliberately doesn't do

These aren't missing features — they're rules Timbre respects.

- **No background playback on mobile.** On desktop, Timbre plays in a background tab exactly like YouTube's or Spotify's own web player. On mobile, locking the screen stops playback — the audio lives inside YouTube's iframe, and background play there is the feature YouTube Premium sells. There's no legitimate way around it.
- **No audio-only YouTube.** The video player stays visible; isolating audio is prohibited.
- **No downloading or caching audio.** Ever.
- **No blending Spotify into the queue.** Spotify's Developer Terms §IV.2 forbid integrating their streams with another service's. The embed is a separate, clearly attributed panel.
- **No gapless cross-source playback.** Handing off between two iframe players always has a small gap. Continuous, not gapless.

## Status

**Phase 0 (foundation) complete.** Monorepo, schema, rate limiter, matching engine and both services run and are verified. **Phase A (search) is next.** See [docs/ROADMAP.md](docs/ROADMAP.md).

## Prerequisites

- Node.js 22+ (developed on 26)
- pnpm 11+
- Python 3.11+
- Docker (local Postgres and a mail catcher)

No API keys, no developer accounts, no subscriptions.

## Setup

```bash
pnpm install
docker compose up -d          # Postgres :5432, Mailpit :8025

cp .env.example .env
# TIMBRE_ENCRYPTION_KEY: openssl rand -base64 32
# AUTH_SECRET:           npx auth secret
# YTMUSIC_SHARED_SECRET: openssl rand -hex 32

pnpm db:migrate

cd apps/ytmusic
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # POSIX: .venv/bin/python
cd ../..
```

All environment variables live in **one root `.env`**. Next.js and drizzle-kit each load it via `dotenv-cli`, since neither looks outside its own directory in a monorepo.

## Running

```bash
pnpm dev            # Next.js on http://127.0.0.1:3000
pnpm dev:ytmusic    # FastAPI sidecar on http://127.0.0.1:8787
```

macOS/Linux: `pnpm dev:ytmusic:posix`.

```bash
curl http://127.0.0.1:3000/api/health
# {"status":"ok","services":{"database":{"status":"ok"},"ytmusic":{"status":"ok"}}, ...}
```

Returns **503** naming the failing service if either is down. Sign-in emails land in Mailpit at http://localhost:8025.

## Layout

```
apps/
  web/        Next.js 16 — search, player orchestration, playlists
  ytmusic/    FastAPI + ytmusicapi — unauthenticated search, holds no secrets
packages/
  core/       canonical models, matching, rate limiter, crypto
  providers/  SearchProvider interface + per-source adapters
  db/         Drizzle schema and migrations
```

The matching engine in `packages/core` is the heart of the product: showing one song across several sources *is* a matching problem.

## Tests

```bash
pnpm test        # all workspace packages
pnpm typecheck
```

One normalization rule matters more than the rest: `(Remastered 2011)` and `(Official Video)` are stripped as noise, but `(Live)`, `(Acoustic)` and `- Remix` are preserved as **variants** and must agree before two tracks merge. On SoundCloud, where remixes *are* the catalogue, collapsing them would be catastrophic.

## Notes

- Next.js 16 renamed the `middleware` convention to `proxy` — see [apps/web/proxy.ts](apps/web/proxy.ts).
- `ytmusicapi` is unofficial and can break when YouTube changes its web client. It's pinned to a minor range and isolated in its own service. It is also Timbre's primary source, so budget for maintenance.
- Never commit `.env`.
