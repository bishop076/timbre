# Deploying Timbre for free

One account, two projects, no card, nothing that sleeps.

*Tier facts verified 2026-08-18 against Vercel's own docs. Re-check them — see
[When this goes stale](#when-this-goes-stale).*

| Piece | Where | Why it is free |
|---|---|---|
| `apps/web` | Vercel Hobby | Next.js, no card, no sleep |
| `apps/ytmusic` | Vercel Hobby, Python runtime | A serverless function, not a server |

**No database, no mail provider, no domain, no container host.**

## Why it is this small

Timbre holds nothing about anyone. Playlists, listening history, volume and
profile all live in the reader's browser (`app/playlists/store.ts`), so there is
no database to run, no account system to own the data and — the part that
actually costs money — no SMTP provider to deliver sign-in links.

The second thing keeping this free is that **Timbre never carries audio**. Every
stream plays in the service's own embedded player, in the reader's browser, over
their connection. Bandwidth is HTML and JSON. A player that proxied audio would
exhaust any free tier in days and would be blocked from a datacenter IP besides
— see the datacenter note in [BLOCKED.md](BLOCKED.md).

## Why the sidecar is a function, not a container

`apps/ytmusic` is a FastAPI app, and the obvious home for it is a small container
on a free tier. Every such tier this project has tried has either died or started
sleeping: Fly's free plan ended in 2024, Koyeb closed to new signups in Feb 2026,
Hugging Face put Docker Spaces behind PRO in Jul 2026. The survivors idle your
service out after ten or fifteen minutes, which means **the first search after a
quiet hour costs a 30–60 second cold boot** — on the one interaction the whole app
is built around.

A serverless function has no idle to sleep through. Vercel's Python runtime loads
a `FastAPI` instance named `app` from `app/main.py`, which is exactly where this
one already lives, so the service deploys unmodified — the same file `uvicorn`
runs locally.

The container is still here. [`apps/ytmusic/Dockerfile`](../apps/ytmusic/Dockerfile)
is built by CI on every release so it cannot rot, and it is the escape hatch if
this tier is the next one to change.

## 1. The sidecar

New Vercel project → this repository → **Root Directory `apps/ytmusic`**.

Vercel detects FastAPI from `pyproject.toml` and finds `app/main.py` on its own.
There is no build command and no start command to write.

One environment variable, and it must be a real value:

```
YTMUSIC_SHARED_SECRET=<openssl rand -hex 32>
```

It is the only thing between the open internet and your quota. `config.py`
refuses to import without it, so a misconfigured deploy fails loudly rather than
serving unauthenticated.

Then verify, with `$SEC` set to that value:

```bash
curl https://<sidecar>.vercel.app/health
# {"status":"ok","service":"ytmusic"}

curl -X POST https://<sidecar>.vercel.app/search \
  -H "X-Timbre-Secret: $SEC" \
  -H "content-type: application/json" \
  -d '{"query":"bicep glue","limit":3}'
# {"items":[{"title":"Glue","artists":["Bicep"],...}]}
```

The second call is the one that matters. It settles the question no
documentation can: whether YouTube serves search from a datacenter IP. The
evidence says it should — the blocking that kills Invidious is on *video
delivery*, which Timbre never does — but evidence is not a measurement.

If it returns results, the deployment works. If it returns 403s, stop here and
read [BLOCKED.md](BLOCKED.md); nothing downstream will help.

## 2. The web app

Second Vercel project → same repository → **Root Directory `apps/web`**.

Vercel installs from the workspace root, so `@timbre/core` and `@timbre/providers`
resolve as source. Two environment variables:

```
YTMUSIC_SHARED_SECRET=<the same value as above>
YTMUSIC_SERVICE_URL=https://<sidecar>.vercel.app
```

**Set both before the first deploy.** They are needed at *build* time, not just at
runtime: `/explore` is prerendered, prerendering registers the providers, and
registering validates the env schema. A build without `YTMUSIC_SHARED_SECRET`
fails while prerendering that one page, with an error that does not obviously
name the cause.

Then:

```bash
curl https://<web>.vercel.app/api/health
# {"status":"ok","services":{"ytmusic":{"status":"ok"}},"configured":{"soundcloud":false}}
```

**503** means the web app cannot reach the sidecar — wrong URL, or the secrets do
not match. It is the only dependency there is.

## What it costs at rest

Nothing, and nothing is running. Both projects scale to zero between requests;
`/explore` is prerendered and revalidates hourly, so the charts cost one set of
upstream calls an hour however many people are reading.

Hobby's monthly allowances, and what actually consumes them:

| | Hobby | What uses it |
|---|---|---|
| Invocations | 1,000,000 | one per search, one per uncached page |
| Active CPU | 4 CPU-hrs | only real CPU — waiting on YouTube does not count |
| Fast Data Transfer | 100 GB | HTML and JSON; Timbre never carries audio |
| Provisioned memory | 360 GB-hrs | |

Per-invocation: 300s maximum (a search takes about two), 2 GB of memory, and a
500 MB Python bundle against a few megabytes here.

**Active CPU is the one to watch**, and it is the reason the shared secret
matters. A search spends nearly all its time waiting on YouTube, which does not
count — but an open sidecar being used as somebody else's free search proxy
would spend real CPU parsing every response, and 4 CPU-hrs is not a lot to give
away.

## When this goes stale

Every fact above has a date on it because free tiers do not keep still. If
something here is wrong:

- **The sidecar tier changed.** The Dockerfile is maintained and CI builds it on
  every release. Any container host will run it; you lose scale-to-zero and gain
  a cold start.
- **The web tier changed.** It is a stock Next.js app with no Vercel-specific
  code. Anything that runs Next will run it.

Nothing in either app imports a platform SDK, and that is deliberate.
