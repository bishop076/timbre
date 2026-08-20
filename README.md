# Timbre

**A music player for people who don't pay for streaming.**

One search box, one queue. Free sources only, and nothing stored on a server.

## Why this exists

Spotify, Apple and Tidal serve people who pay. Nobody builds well for people who don't.

YouTube Music's free tier plus SoundCloud is an enormous catalogue — remixes, DJ sets, live rips, indie uploads and unofficial releases that **aren't on Spotify at all** — and there's no good unified player for it.

Timbre is mostly a shell around other services' own players. **It hosts nothing.** Audio streams from the service it belongs to — for YouTube Music and SoundCloud through that service's official player, so ads run and artists are paid exactly as they would be otherwise. What belongs to Spotify stays in Spotify.

**Audius is the exception, and it is worth stating plainly.** It publishes progressive audio with no player to embed, so Timbre renders its own `<audio>` element pointed at Audius's CDN. Nothing is downloaded or cached and no byte is re-hosted — but it is Timbre's player, not theirs. Plays are still asked to count: the stream endpoint hands back `skip_play_count=true` by default, so Timbre passes `skip_play_count=false` explicitly. **This is verified to work** — measured 2026-08-19, a single range request with the flag set moved that track's `play_count` from 29,931 to 29,932. Listens through Timbre register on Audius.

That constraint is the whole design: four services' catalogues can be searched together, but their audio cannot be pooled into one stream without breaking every one of their terms.

## What it does

- **Search** one box → results from YouTube Music and Audius, merged with availability on
  Deezer and Apple
- **Play** a continuous queue, from YouTube Music and Audius. A track resolves to a playable
  copy at play time, and falls through to another upload when one refuses to embed
- **Explore** charts fused across Deezer and Apple, so agreeing on two beats charting
  higher on one — plus genres, radios and editorial lists
- **Lyrics** synced from LRCLIB, with a version picker and a timing nudge
- **Playlists** of your own, saved in your browser — no account, no sign-up
- **A profile** with a name and pictures, kept on the device rather than uploaded

**Audius is the second source you can actually play**, and the only one that needed no key,
no account and no approval. It is also the first source Timbre plays *itself* — a real
`<audio>` element rather than someone else's iframe — which is a deliberate change in what
the product is, not a drift. Nothing is downloaded or cached; the bytes still come from
Audius's own CDN.

Its catalogue is worth knowing about: searching for chart songs returns **remixes, edits,
mashups and hour-long DJ sets, not the originals** — which is why the variant rule below is
load-bearing rather than a nicety.

**What makes it complementary is narrower than "it has the remixes", and worth stating
accurately.** YouTube Music has remixes too — asked for `flume remix` it returns the Lorde
and Disclosure ones, and `boiler room set` returns hour-long DJ sets. The difference is
*whose* remixes. Taking Audius results and searching YouTube Music for that exact artist and
title, **10 of 12 were not there at all** (measured 2026-08-19): YouTube Music carries the
derivatives that were licensed and distributed, Audius carries the ones uploaded by the
person who made them. Audius is the unsigned-upload source, not the remix source.

SoundCloud is registered and its player works, but **catalogue search is off unless the
operator turns it on**: searching needs a `client_id` behind a paid account, so by default
nothing surfaces its tracks and a pasted URL is the only way one arrives. Two opt-in routes
need no approval — point `SOUNDCLOUD_API_BASE` at an api-v2 proxy you run, or set
`SOUNDCLOUD_DIRECT_API` and let Timbre resolve a guest id itself. Both are off in the hosted
build, and turning either on moves the technique and the terms exposure to whoever turned it
on. See [docs/BLOCKED.md](docs/BLOCKED.md) and
[docs/SOUNDCLOUD-PROXIES.md](docs/SOUNDCLOUD-PROXIES.md). Spotify is not integrated at all —
see below.

## What it deliberately doesn't do

These aren't missing features — they're rules Timbre respects.

- **No background playback on mobile**, for anything playing through YouTube. On desktop, Timbre plays in a background tab exactly like YouTube's or Spotify's own web player. On mobile, locking the screen stops playback — the audio lives inside YouTube's iframe, and background play there is the feature YouTube Premium sells. There's no legitimate way around it. Audius is technically different, since that audio is Timbre's own element rather than an iframe, but the behaviour is not built or tested and should not be assumed.
- **No audio-only YouTube.** The video player stays visible; isolating audio is prohibited.
- **No downloading or caching audio.** Ever.
- **No Spotify.** Their Developer Terms §IV.2 forbid integrating Spotify streams with another service's, so it could only ever be a separate, clearly attributed panel — and that panel is not built. Nothing in the app talks to Spotify today.
- **No gapless cross-source playback.** Handing off between two players — two iframes, or an iframe and an audio element — always has a small gap. Continuous, not gapless.
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

See [docs/BLOCKED.md](docs/BLOCKED.md) for what is waiting on somebody else.

## Prerequisites

- Node.js 22+ (developed on 26)
- pnpm 11+
- Python 3.11+
- [uv](https://docs.astral.sh/uv/) — installs the sidecar from its lockfile

No database, no Docker, no API keys, no developer accounts, no subscriptions.

## Setup

```bash
pnpm install

cp .env.example .env
# set YTMUSIC_SHARED_SECRET — the sidecar refuses to boot without it:
#   openssl rand -hex 32

cd apps/ytmusic
uv sync --extra dev        # or: python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
cd ../..
```

`YTMUSIC_SHARED_SECRET` is the only value you must supply; `YTMUSIC_SERVICE_URL` defaults
to loopback. Both live in **one root `.env`**, loaded via `dotenv-cli` because Next does
not look outside its own directory in a monorepo.

The sidecar's dependencies are locked in `apps/ytmusic/uv.lock`, which is what CI and
Vercel both install from — `uv sync` reproduces those versions exactly, while the pip route
re-resolves and may not. Changing a dependency means re-running `uv lock` and committing
the result, or CI fails on `--locked`.

## Running

**Two terminals, and both are required.** The sidecar is the web app's only dependency:
start the web app alone and it will run perfectly well, serve pages, and find nothing.

```bash
pnpm dev:ytmusic    # FastAPI sidecar on http://127.0.0.1:8787   ← start this first
pnpm dev            # Next.js on http://127.0.0.1:3000
```

macOS/Linux: `pnpm dev:ytmusic:posix` — the default script points at the Windows venv layout.

```bash
curl http://127.0.0.1:3000/api/health
# {"status":"ok","services":{"ytmusic":{"status":"ok"}},"configured":{"soundcloud":false}}
```

Returns **503** if the sidecar is down. `"soundcloud":false` is expected — its catalogue
search is gated, see [docs/BLOCKED.md](docs/BLOCKED.md).

**Setup problems, verification steps and the failure modes worth recognising live in
[RUNNING.md](RUNNING.md).** Start there before assuming the app is broken; the most common
symptom by far — search returning nothing — is just the sidecar not running.

## Layout

```
apps/
  web/        Next.js 16 — search, player orchestration, playlists
  ytmusic/    FastAPI + ytmusicapi — unauthenticated search, holds no secrets
packages/
  core/       canonical models, matching, rate limiter, error taxonomy
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

- `ytmusicapi` is unofficial and can break when YouTube changes its web client. It's pinned to a minor range and isolated in its own service. It is also Timbre's primary source, so budget for maintenance.
- Never commit `.env`.
