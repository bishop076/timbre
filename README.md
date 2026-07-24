# Timbre

One library across Spotify, YouTube Music, and SoundCloud — unified browsing and search now, playlist sync next.

## The constraint that shapes everything

Timbre does not hold Spotify or YouTube API keys, and that is deliberate rather than an oversight.

As of February 2026 a Spotify app in Development Mode is capped at **5 users**, and extended quota requires a registered business with **250,000 monthly active users** — you must be big before you are permitted to grow. YouTube has no official Music API, and its 10,000 units/day default works out to roughly 200 track-adds.

So **credentials belong to the user**: each person registers their own free developer app and Timbre encrypts and stores those credentials for them. Each user then spends their own quota, and there is no cap to hit. SoundCloud, whose self-service registration reopened in May 2026, is the one provider Timbre keys centrally.

Full reasoning and sources: [docs/PLAN.md](docs/PLAN.md).

## Status

**Phase 0 (foundation) is complete.** The scaffolding, schema, crypto, rate limiter, and both services run and are verified. No provider adapters exist yet — that is Phase 1.

## Prerequisites

- Node.js 22+ (developed on 26)
- pnpm 11+
- Python 3.11+
- Docker (for local Postgres and a mail catcher)

## Setup

```bash
pnpm install

# Postgres on :5432 and Mailpit on :8025
docker compose up -d

# Secrets. Generate real values for anything deployed.
cp .env.example .env
# TIMBRE_ENCRYPTION_KEY: openssl rand -base64 32
# AUTH_SECRET:           npx auth secret
# YTMUSIC_SHARED_SECRET: openssl rand -hex 32

pnpm db:migrate

# Python sidecar
cd apps/ytmusic
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # POSIX: .venv/bin/python
cd ../..
```

All environment variables live in **one root `.env`**. Next.js and drizzle-kit each load it via `dotenv-cli`, since neither looks outside its own directory in a monorepo.

## Running

Two processes:

```bash
pnpm dev            # Next.js on http://localhost:3000
pnpm dev:ytmusic    # FastAPI sidecar on http://127.0.0.1:8787
```

On macOS or Linux use `pnpm dev:ytmusic:posix` (different venv layout).

Check both at once:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","services":{"database":{"status":"ok"},"ytmusic":{"status":"ok"}}, ...}
```

It returns **503** with the failing service named if either is down.

Sign-in emails are caught by Mailpit at http://localhost:8025 — no real SMTP needed.

## Layout

```
apps/
  web/        Next.js 16 (App Router) — UI, OAuth callbacks, API routes
  ytmusic/    FastAPI + ytmusicapi — stateless, internal-only, holds no secrets
packages/
  core/       canonical models, AES-256-GCM crypto, rate limiter, normalization
  providers/  MusicProvider interface + registry (adapters land in Phase 1)
  db/         Drizzle schema, migrations, Postgres-backed rate buckets
```

The `MusicProvider` interface in `packages/providers/src/types.ts` is the seam the whole app is built on: every service quirk is absorbed by an adapter, and nothing above that layer branches on which service a track came from.

## Tests

```bash
pnpm test        # all workspace packages
pnpm typecheck
```

Unit tests cover the logic that is genuinely ours and worth pinning — token-bucket accounting, quota-vs-throttle classification, envelope encryption, and title normalization. Provider integrations are verified against real accounts instead, because mocking a third-party API mostly tests the mock.

One normalization rule is worth knowing about: `(Remastered 2011)` and `(Official Video)` are stripped as noise, but `(Live)`, `(Acoustic)` and `- Remix` are preserved as *variants*. Collapsing those would silently swap a user's studio track for a live cut, which is the most damaging thing a playlist transfer can do.

## Notes

- Next.js 16 renamed the `middleware` convention to `proxy` — see [apps/web/proxy.ts](apps/web/proxy.ts).
- `ytmusicapi` is unofficial and can break when YouTube changes its web client. It is pinned to a minor range and isolated in its own service so the blast radius is one deployable.
- Never commit `.env`. It holds keys that decrypt users' stored tokens.
