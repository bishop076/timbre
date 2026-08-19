# Running Timbre locally

Two processes and one `.env`. **No database, no Docker, no accounts, no API keys.**

> Superseded the previous version of this file, which described the pre-`e688ab4`
> architecture — Postgres, Mailpit, `pnpm db:migrate`, `AUTH_SECRET`, magic-link sign-in.
> All of that was deleted with accounts and the database. If you followed it, nothing you
> did was wrong; the instructions were.

---

## What you need

| | |
| :--- | :--- |
| Node.js | 22+ (developed on 26) |
| pnpm | 11+ |
| Python | 3.11+ |
| [uv](https://docs.astral.sh/uv/) | optional, but it is what CI and Vercel install from |

## Setup, once

```bash
pnpm install

cp .env.example .env
# then set YTMUSIC_SHARED_SECRET — see below

cd apps/ytmusic
uv sync --extra dev
# no uv?  python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
cd ../..
```

### The one variable that matters

`YTMUSIC_SHARED_SECRET` is the only value you must supply. It proves the web app is the
caller rather than the open internet, and **the sidecar refuses to boot without it.**

```bash
openssl rand -hex 32
```

`YTMUSIC_SERVICE_URL` defaults to `http://127.0.0.1:8787` and can be left alone locally.

Both live in **one root `.env`**, loaded by `dotenv-cli` — Next does not look outside its
own directory in a monorepo, which is why `apps/web`'s scripts all start with
`dotenv -e ../../.env --`.

> On the sidecar side the variable is read as a **comma-separated list**, newest first, so
> a secret can be rotated without downtime: add the new one alongside the old, move the web
> app across, then drop the old. Locally one value is all you need.

## Start it

**Two terminals. Both are required** — the sidecar is the web app's only dependency, and
without it search returns nothing.

```bash
pnpm dev:ytmusic     # FastAPI sidecar  → http://127.0.0.1:8787
pnpm dev             # Next.js          → http://127.0.0.1:3000
```

macOS and Linux: `pnpm dev:ytmusic:posix` — the default script points at
`.venv/Scripts/python`, which is the Windows layout.

## Check it

```bash
curl http://127.0.0.1:8787/health
# {"status":"ok","service":"ytmusic"}

curl http://127.0.0.1:3000/api/health
# {"status":"ok","services":{"ytmusic":{"status":"ok"}},"configured":{"soundcloud":false}}
```

The web health route returns **503** when the sidecar is down. `"soundcloud":false` is
correct and expected — its catalogue search is gated, see [docs/BLOCKED.md](docs/BLOCKED.md).

End to end:

```bash
curl "http://127.0.0.1:3000/api/search?q=Harry%20Styles%20As%20It%20Was"
```

The first song should be **`As It Was (Official Video)`**, video id `H5v3kku4y6Q`,
`video_type` `MUSIC_VIDEO_TYPE_OMV`, merged with Deezer's ISRC `USSM12200612`. An `_ATV`
art track leading instead means the ranking regressed — see `docs/BUGS.md` B-2 and B-3.

Straight from the sidecar, skipping the web app:

```bash
SEC=$(grep '^YTMUSIC_SHARED_SECRET=' .env | cut -d= -f2 | tr -d '\r\n')
curl -s -X POST http://127.0.0.1:8787/search \
  -H "Content-Type: application/json" -H "X-Timbre-Secret: $SEC" \
  -d '{"query":"Harry Styles As It Was","limit":5}'
```

Sidecar surface, in full: `GET /health`, `POST /search`, `POST /resolve`, `POST /radio`.

---

## When it does not work

**Search returns nothing, or `/api/health` gives 503.**
The sidecar is not running. This is the common one by a wide margin, and it looks like a
broken app rather than a missing process because the web app starts perfectly well without
it.

```bash
netstat -ano | grep :8787      # nothing listening = that is your answer
```

**`ConfigError: YTMUSIC_SHARED_SECRET is not set`.**
You ran `python -m uvicorn ...` directly. Nothing loads `.env` in that path — `pnpm
dev:ytmusic` wraps the command in `dotenv-cli`, which is what supplies it. Use the script.

**500s from the sidecar with nothing in the log, or code changes having no effect.**
`pnpm dev:ytmusic` spawns a uvicorn reloader *and* a child. Killing the parent orphans the
child, which keeps 8787 bound and serves stale code.

```bash
powershell -NoProfile -Command "Get-Process python* | Select-Object Id,StartTime"
# kill anything older than the run you just started
```

**"Video unavailable" on every track, in every browser.**
The player rendered below **200×200**, YouTube's documented minimum. It fails identically
to an ad blocker, which is what made it cost a day the first time. `docs/BUGS.md` B-1.
Do not shrink the player at any breakpoint.

**"Video unavailable" on one track only.**
Normal. That upload bars embedding — error `101`/`150`, measured at roughly 7% of art
tracks — and the player falls through to another upload of the same song. Log the
**numeric** `onError` code, never the message.

**Your `.env` mentions `DATABASE_URL`, `AUTH_SECRET`, `TIMBRE_ENCRYPTION_KEY` or
`EMAIL_*`.**
Leftovers from before accounts were removed. Nothing reads them — `apps/web/lib/env.ts`
ignores unknown keys — so they are harmless, just misleading about what the app needs.

---

## Tests

```bash
pnpm test          # every workspace package, plus scripts/*.test.mjs
pnpm typecheck     # runs next typegen first; a fresh clone fails without it
pnpm lint

cd apps/ytmusic && .venv/Scripts/python.exe -m pytest -q
```

Changing a Python dependency means re-running `uv lock` and committing the result, or CI
fails on `--locked`.
