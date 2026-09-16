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

- One search box → YouTube Music, Audius and Mixcloud at once, merged into one row per song
  instead of four near-duplicates, with availability shown on Deezer and Apple
- Suggestions as you type, and the query lives in the URL — a search reloads and shares
- Charts fused across Deezer and Apple, plus genres, radios, editorial lists and genre mixes
- Artist and album pages, and a similar-songs panel off whatever is playing
- Paste a Spotify, YouTube or SoundCloud link and it just plays
- Live concert tapes from the Archive suggested alongside a band that allows taping
- SoundCloud catalogue search too, when whoever runs the app opts in with
  `SOUNDCLOUD_DIRECT_API=true` or points at an `api-v2`-shaped base of their own. Off in the
  hosted build; pasted SoundCloud links play either way

**Play it**

- A continuous queue that resolves a playable copy *at play time*, and falls through to
  another upload when one refuses to embed
- Radio carries on when the queue runs dry; reorder it, queue a song next, search within it
- Synced lyrics from LRCLIB or YouTube Music, scrolling in time
- Playback speed, a sleep timer, volume memory and keyboard transport keys
- A second tab becomes a remote for the tab that is playing, rather than fighting it
- Connect a Spotify account and its tracks play here — in full with Premium, through
  Spotify's own Web Playback SDK, and as a 30-second preview without it. It needs a Spotify
  client id, either set by whoever runs the app or pasted in by the reader

**Keep it**

- Playlists, liked songs and history — no account, saved in your browser
- Listening stats: top songs and artists, totals, first and last play, by day and weekday
- Save someone else’s playlist or an album as your own
- Export a playlist to CSV, or back the whole profile up to one JSON file and restore it

**Make it yours**

- One colour drives the whole theme — violet by default, or taken from the album art, fixed
  to a colour you pick, or slowly drifting while you listen
- Your own background picture and typeface, both redrawn and kept in this browser
- A profile name, avatar and banner — resized in the browser, never uploaded
- Installs as a PWA, works on a phone, and has no sign-up, no telemetry and no database

> **The look is mid-redesign** (`feat/redesign`). The colour, background and typeface
> controls above are in the tree and working; the surrounding layout is still moving towards
> something closer to Spotify and Apple Music. Read anything about visual design here as work
> in progress rather than as what a fresh clone looks like.

## What it deliberately doesn't do

No background playback on mobile, no audio-only YouTube, no downloading or caching, no
gapless cross-source handoff, no accounts and no server-side data. These are rules Timbre
respects rather than features it is missing.

## Running

Node 22+, pnpm 11+, Python 3.11+ and [uv](https://docs.astral.sh/uv/). No database, no
Docker and no third-party API keys — the one value you must supply is
`YTMUSIC_SHARED_SECRET`, which you generate yourself and which the two processes use to
recognise each other.

```bash
pnpm install && (cd apps/ytmusic && uv sync --extra dev)
[ -f .env ] || cp .env.example .env    # then set YTMUSIC_SHARED_SECRET

pnpm dev:ytmusic    # FastAPI sidecar on 127.0.0.1:8787   ← start this first
pnpm dev            # Next.js on 127.0.0.1:3000
```

On macOS and Linux the first command is `pnpm dev:ytmusic:posix` — the default points at
`.venv/Scripts/python`, which is the Windows layout.

Both terminals are required: start the web app alone and it will serve pages and find
nothing. **[RUNNING.md](RUNNING.md) covers setup, the `.env` it needs, and the failure modes
worth recognising** — start there before assuming the app is broken.

## Layout

```
apps/web/        Next.js 16 — search, player orchestration, playlists
apps/ytmusic/    FastAPI + ytmusicapi — queries YouTube Music with no account of its own;
                 the only secret it holds is the one the web app authenticates to it with
packages/core/   canonical models, matching, rate limiter, error taxonomy
packages/providers/  SearchProvider interface + per-source adapters
```

The two deploy as two separate Vercel projects off this one repository — the web app from
`apps/web`, the sidecar from `apps/ytmusic` on Vercel's Python runtime. **[docs/DEPLOY.md](docs/DEPLOY.md)**
has the whole of it, including rotating the shared secret without downtime.

There is no database. Everything a person owns lives in their own browser, which is what
makes this free to host. The matching engine in `packages/core` is the heart of it: showing
one song across several sources *is* a matching problem.

```bash
pnpm test && pnpm typecheck
```

`ytmusicapi` is unofficial and can break when YouTube changes its web client — it's pinned
and isolated in its own service, but budget for maintenance.

## Licence

[AGPL-3.0](LICENSE). The code is free software; if you run a modified Timbre for other
people, section 13 means you owe those users your source.

The name and the mark are not covered — see [NOTICE](NOTICE). Fork it and run it, but give
it your own name.
