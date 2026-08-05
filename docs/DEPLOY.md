# Deploying Timbre for free

Two accounts, two environment variables, no credit card.

*Tier facts verified 2026-08-16. Re-check them — see [When this goes stale](#when-this-goes-stale).*

| Piece | Service | Free tier |
|---|---|---|
| `apps/web` | **Vercel Hobby** | no card, no sleep, 100 GB/month |
| `apps/ytmusic` | **Render** free web service | 512 MB, 750 instance-hrs/month/workspace |

That is the whole deployment. **No database, no mail provider, no domain.**

## Why it is this small

Timbre holds nothing about anyone. Playlists, listening history, volume and
profile all live in the reader's browser (`app/playlists/store.ts`), so there is
no database to run, no account system to own the data and — the part that
actually costs money — no SMTP provider to deliver sign-in links.

That was a deliberate trade and it is worth restating, because it is what makes
this page short. Server-side playlists would have required Postgres, an account
system, and an email sender whose free tiers either cap at your own address
(Resend, without a verified domain) or need a domain you have to buy. Local
playlists need none of it. The cost is that playlists do not follow you between
devices and are lost if you clear site data, which is why export is a
first-class feature rather than a nicety.

The second thing keeping this free is that **Timbre never carries audio**. Every
stream plays in the service's own embedded player, in the reader's browser, over
their connection. Bandwidth is HTML and JSON. A player that proxied audio would
exhaust any free tier in days and would be blocked from a datacenter IP besides
— see the datacenter note in [BLOCKED.md](BLOCKED.md).

## 1. Sidecar — do this first

**Deploy this alone and test it before anything else.** It takes ten minutes and
settles the one question no documentation can: whether YouTube serves search
requests from a datacenter IP. The evidence says it should — the blocking that
kills Invidious is on video delivery, which Timbre does not do — but evidence is
not a measurement.

New Render **Web Service** → this repo → **Docker** runtime → root directory
`apps/ytmusic`. [Its Dockerfile](../apps/ytmusic/Dockerfile) already binds
`$PORT`.

One environment variable, and it needs to be a real value:

```
YTMUSIC_SHARED_SECRET=<openssl rand -hex 32>
```

It is the only thing between the open internet and your quota.

Then verify, with `$SEC` set to that value:

```bash
curl https://<service>.onrender.com/health
# {"status":"ok","service":"ytmusic"}

curl -s -X POST https://<service>.onrender.com/search \
  -H "Content-Type: application/json" -H "X-Timbre-Secret: $SEC" \
  -d '{"query":"Harry Styles As It Was","limit":5}'
```

A populated `items` array settles it. Empty results, a `403`, or anything about
confirming you are not a bot means **stop** — record it in BLOCKED.md and read
[If the sidecar is blocked](#if-the-sidecar-is-blocked).

### The cold start, and the arithmetic that fixes it

Free Render services **sleep after 15 minutes idle and take about a minute to
wake**. On a music player that is the difference between a product and a demo:
the first search of every session would stall for a minute, and Vercel functions
give up at 60 seconds, so it would not stall — it would fail.

A month is 730 hours and Render grants 750 instance-hours per workspace, so
**one** service can stay awake permanently with 20 hours to spare. Point a free
scheduler (cron-job.org or similar) at `/health` every 10 minutes.

That budget covers exactly one always-on service, which is why the web app goes
to Vercel rather than a second Render service.

## 2. Web app

Import the repo on Vercel, root directory `apps/web`. It detects Next.js and the
pnpm workspace on its own.

| Variable | Value |
|---|---|
| `YTMUSIC_SERVICE_URL` | `https://<service>.onrender.com` |
| `YTMUSIC_SHARED_SECRET` | identical to the sidecar's |

`SOUNDCLOUD_CLIENT_ID` / `_SECRET` are optional and should stay unset — the
provider is deliberately unregistered ([BLOCKED.md](BLOCKED.md)).

[The root Dockerfile](../Dockerfile) is **not** used here. It is a tested
fallback for the day Vercel's terms change, not part of this path.

Confirm the whole graph in one call:

```bash
curl https://<project>.vercel.app/api/health
# {"status":"ok","services":{"ytmusic":{"status":"ok"}},...}
```

That endpoint reports the sidecar, so a `200` means the two halves found each
other rather than merely that the app booted.

## Before inviting anyone else

Personal use sits comfortably inside every limit. A public link does not, and
the binding constraint is not money:

- **Apple allows ~20 requests/minute per IP**, and every visitor shares the
  deployment's one outbound address. `/api/search` is cached for two minutes and
  deduplicates concurrent identical calls (`lib/cache.ts`), and every public
  route is capped at 60 requests/minute per client (`lib/rate-limit.ts`). Both
  are per instance — with no database there is nowhere shared to count — so
  treat them as back-pressure against accidents, not as access control.
- **Vercel Hobby is non-commercial only.** No ads, no payments. Donations are
  explicitly fine.
- **`ytmusicapi` is unofficial** and can break when YouTube changes its web
  client. A public deployment means that breakage is now other people's problem
  too. Budget for it, or keep the link private.

## If the sidecar is blocked

No free host fixes a datacenter-IP block, because every free tier is a
datacenter IP. The options, in order of what they cost you:

1. **Self-host on a machine you own.** A residential IP is the actual fix.
   Costs an always-on machine.
2. **A VPS with a cleaner IP range, or a residential proxy.** Costs money, which
   collides with the standing non-goal.
3. **Move search into the browser**, so the reader's own IP makes the request.
   Structurally dodges the block and stays free, but forfeits what makes the
   sidecar safe: it is credential-free and secret-guarded precisely so that
   compromising it yields nothing ([main.py](../apps/ytmusic/app/main.py)).
   A last resort, not a preference.

## When this goes stale

Free container hosting churned hard, and every tier fact here has a shelf life:

| Host | What happened |
|---|---|
| Fly.io | free tier ended Oct 2024 |
| Koyeb | closed to new signups Feb 2026 (Mistral acquisition) |
| Hugging Face | Docker Spaces moved behind PRO, Jul 2026, with no announcement |

Three of four candidate hosts died inside twenty months. Re-verify before
trusting this document, and prefer a primary source — Hugging Face's pricing
page still advertised CPU Basic as free while its own docs said Docker Spaces
required a paid plan.

Timbre is well placed for that churn, and not by luck. The sidecar is stateless,
credential-free, touches no database and is one Dockerfile; the web app is a
stateless front end over public catalogues. Moving either is an afternoon. That
portability is a reason to keep the boundary, not just a side effect of Python
versus TypeScript.
