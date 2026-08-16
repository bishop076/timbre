# Timbre

**A music player for people who don't pay for streaming.**

One search box, one queue. Free sources only, and nothing stored on a server.

## Why this exists

Spotify, Apple and Tidal serve people who pay. Nobody builds well for people who don't.

YouTube Music's free tier plus SoundCloud is an enormous catalogue — remixes, DJ sets, live rips, indie uploads and unofficial releases that **aren't on Spotify at all** — and there's no good unified player for it.

Timbre is a shell around other services' own players. **It hosts nothing.** Audio always streams from the service it belongs to, through that service's official player, so ads run and artists are paid exactly as they would be otherwise. What belongs to Spotify stays in Spotify.

The full reasoning — including why the original "connect all three accounts" idea is impossible — is in [docs/PLAN.md](docs/PLAN.md).

## What it does

- **Search** one box → results from YouTube Music, merged with availability on Deezer and Apple
- **Play** a continuous queue, from YouTube Music. A track resolves to a playable copy at
  play time, and falls through to another upload when one refuses to embed
- **Explore** charts fused across Deezer and Apple, so agreeing on two beats charting
  higher on one — plus genres, radios and editorial lists
- **Lyrics** synced from LRCLIB, with a version picker and a timing nudge
- **Playlists** of your own, saved in your browser — no account, no sign-up
- **A profile** with a name and pictures, kept on the device rather than uploaded

SoundCloud has a working player and provider, but is **not** registered: catalogue search
needs a `client_id` behind a paid account, so nothing surfaces its tracks yet. Spotify is
not integrated at all — see below.

## What it deliberately doesn't do

These aren't missing features — they're rules Timbre respects.

- **No background playback on mobile.** On desktop, Timbre plays in a background tab exactly like YouTube's or Spotify's own web player. On mobile, locking the screen stops playback — the audio lives inside YouTube's iframe, and background play there is the feature YouTube Premium sells. There's no legitimate way around it.
- **No audio-only YouTube.** The video player stays visible; isolating audio is prohibited.
- **No downloading or caching audio.** Ever.
- **No Spotify.** Their Developer Terms §IV.2 forbid integrating Spotify streams with another service's, so it could only ever be a separate, clearly attributed panel — and that panel is not built. Nothing in the app talks to Spotify today.
- **No gapless cross-source playback.** Handing off between two iframe players always has a small gap. Continuous, not gapless.
- **No accounts, and no data.** Timbre asks for no email and keeps no user record. Playlists, your profile and your history live in your browser and nowhere else. Nothing to breach, nothing to subpoena, nothing to pay for — and the honest cost is that clearing site data loses them, so **Export** exists on the library page. It covers playlists; your profile and history are not in the file yet. One cookie is set, `timbre-name`, so your own display name is in the first paint rather than arriving a frame later.

## Status

Search and playlists are done; playback and polish are most of the way there.

| Phase | | |
| :--- | :--- | :--- |
| 0 — Foundation | 33/33 | ✅ |
| A — Search | 24/24 | ✅ |
| B — Playback | 28/33 | 🔨 |
| C — Playlists | 12/13 | ✅ |
| D — Polish and launch | 12/20 | 🔨 |

See [docs/ROADMAP.md](docs/ROADMAP.md) for the task-level detail and [docs/BLOCKED.md](docs/BLOCKED.md) for what is waiting on somebody else.

## Prerequisites

- Node.js 22+ (developed on 26)
- pnpm 11+
- Python 3.11+

No database, no API keys, no developer accounts, no subscriptions.

## Setup

```bash
pnpm install

cp .env.example .env
# YTMUSIC_SHARED_SECRET: openssl rand -hex 32

cd apps/ytmusic
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # POSIX: .venv/bin/python
cd ../..
```

Both environment variables live in **one root `.env`**, loaded via `dotenv-cli` because Next does not look outside its own directory in a monorepo.

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

Returns **503** if the sidecar is down. It is the only dependency there is.

## Layout

```
apps/
  web/        Next.js 16 — search, player orchestration, playlists
  ytmusic/    FastAPI + ytmusicapi — unauthenticated search, holds no secrets
packages/
  core/       canonical models, matching, rate limiter, crypto
  providers/  SearchProvider interface + per-source adapters
```

There is no database package, and no database. Everything a person owns lives in
their own browser: playlists, display name, history, theme and volume in
`localStorage`, and profile pictures in IndexedDB, which holds blobs at their real
size instead of inflating them by a third as base64. The queue is deliberately not
persisted — a refresh starts empty. So the web app is a stateless front end and the
only thing behind it is the sidecar. That is what makes it free to host.

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
