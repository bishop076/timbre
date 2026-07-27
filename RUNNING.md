# Running Timbre locally

Set up and verified on 2026-08-15. Branch: `fix/embed-candidates`.

## Already done for you

- `.env` created from `.env.example`, with `TIMBRE_ENCRYPTION_KEY`, `AUTH_SECRET`
  and `YTMUSIC_SHARED_SECRET` generated
- Postgres + Mailpit running via `docker compose up -d`
- Database migrated (`pnpm db:migrate`)
- Node deps installed (`pnpm install`)
- Python venv at `apps/ytmusic/.venv` with the sidecar installed

## Start it

Two processes, two terminals:

```bash
pnpm dev:ytmusic     # YouTube Music sidecar → http://127.0.0.1:8787
pnpm dev             # web app              → http://localhost:3000
```

Mailpit (catches magic-link sign-in email): http://localhost:8025

## Check the fix

Search **Harry Styles As It Was** or **Dua Lipa Levitating** — both had an art
track that refuses to embed, and both now lead with an official video that plays.

Expected first results:

| Query | First result | Was |
|---|---|---|
| Harry Styles As It Was | `H5v3kku4y6Q` OMV | `nujn6wbr-e8` ATV — **barred, error 150** |
| Dua Lipa Levitating | `TUVcZfQe-Kw` OMV | `e8WoWk4b3D0` ATV — **barred, error 150** |
| Tame Impala Dracula JENNIE Remix | `0UPDBODtxzw` OMV | the track from the original screenshot |

Straight from the sidecar:

```bash
SEC=$(grep '^YTMUSIC_SHARED_SECRET=' .env | cut -d= -f2 | tr -d '\r\n')
curl -s -X POST http://127.0.0.1:8787/search \
  -H "Content-Type: application/json" -H "X-Timbre-Secret: $SEC" \
  -d '{"query":"Harry Styles As It Was","limit":5}' | python -m json.tool
```

Every `video_type` should now be present, and `MUSIC_VIDEO_TYPE_OMV` should sort
ahead of `MUSIC_VIDEO_TYPE_ATV`.

## What to watch in the browser console

Log the **numeric** `onError` code, not a message. `150`/`101` mean that upload
bars embedding and the player should fall through to the next candidate — which
is normal and expected on roughly 7% of art tracks. What you should *not* see any
more is every track failing.

**Keep the player at least 200×200 at every breakpoint.** Below YouTube's
documented minimum it fails with a bare "Video unavailable" on *every* track,
which looks exactly like an ad blocker. That was the original bug, fixed in
`de15d86` — a CSS regression would silently bring it back.

## Gotcha hit during setup

`pnpm dev:ytmusic` spawns a uvicorn reloader plus a child. Killing the parent can
orphan the child, which keeps port 8787 bound and serves **stale code** — the
symptom is `500`s with nothing in the log. If that happens:

```bash
powershell -NoProfile -Command "Get-Process python* | Select-Object Id,StartTime"
# kill any older than your current run
```

## Tests

```bash
cd apps/ytmusic && .venv/Scripts/python.exe -m pytest -q   # 34 passing
pnpm typecheck
pnpm test
```

## What changed

`e6f273c` — two files:

- `apps/ytmusic/app/models.py` — added `video_type` to `Track`. Without it
  pydantic silently dropped the value, so the ranking added in `4c49037` compared
  every track as equal and did nothing.
- `apps/ytmusic/app/routes/search.py` — always search `filter="videos"` instead of
  only when the songs filter came back thin (it almost never does), and rank
  `OMV → UGC → unknown → ATV`.

Background and measurements: `../ytube/timbre-solutions.md`.
