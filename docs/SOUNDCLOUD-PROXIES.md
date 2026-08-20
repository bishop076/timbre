# SoundCloud catalogue search: who runs an api-v2 proxy

Measured 2026-08-20. `docs/BLOCKED.md` explains why SoundCloud search is off by default and
why `SOUNDCLOUD_API_BASE` exists; this is the survey of what you can actually point it at.

## What Timbre needs

`packages/providers/src/soundcloud.ts` calls `{base}/search/tracks?q=…&limit=…` and expects
`api-v2.soundcloud.com`'s own JSON shape — `collection[]`, each entry with `id`, `title`,
`duration`, `permalink_url`, `user.username`, `publisher_metadata.isrc`. So the base must be
a **reverse proxy that speaks api-v2 and supplies the `client_id` itself**. A proxy wanting
*your* credentials is no use: the credentials are the thing that is gated.

## Only one project implements that shape

**[soundcloak](https://github.com/maid-zone/soundcloak)** (AGPL-3.0, Go, mirrored from
`git.maid.zone`). Its `docs/API.md` documents `/_/api/v2/…` as a proxy for
`api-v2.soundcloud.com` that "automatically adds latest `client_id` value to your requests".
GET only; headers and body are ignored; the allowlist covers `/resolve`, `/charts/selections`,
`/mixed-selections`, `/users/…`, `/tracks/…`, **`/search/…`**, `/playlists/…` and
`/featured_tracks/…`. Gated behind `EnableAPI`, which is **off by default**, and
`/_/info` reports whether an instance has it on.

Everything else found is a different shape and would need its own provider, not this variable:

| Project | Why not |
|---|---|
| [voronianski/soundcloud-api-proxy](https://github.com/voronianski/soundcloud-api-proxy) | Proxies with *your* client secret. Last touched 2024, 2 stars. |
| [chriszhangusc/soundcloud-api-proxy](https://github.com/chriszhangusc/soundcloud-api-proxy) | Same, 2023. |
| [zackradisic/soundcloud-api](https://github.com/zackradisic/soundcloud-api) | A Go *library* that scrapes a `client_id`. A base to build a proxy on, not one to run. |
| 4get | Metasearch with a SoundCloud scraper, but its own JSON. A separate provider, not this base. |

## Instances, all tested against the exact call Timbre makes

Ten listed at [maid.zone/soundcloak/instances.html](https://maid.zone/soundcloak/instances.html).
Each was asked `/_/info` for `EnableAPI`, then
`/_/api/v2/search/tracks?q=daft+punk&limit=3`, then driven through Timbre's own provider —
four queries, 20 results each, so parsing is exercised and not just reachability.

| Instance | `EnableAPI` | Search | Tracks | 30s-gated | ISRC | Latency |
|---|---|---|---|---|---|---|
| `soundcloak.tijn.dev` (DE) | yes | **200** | 80 | **4%** | 28 | **681 ms** |
| `sc.monochrome.tf` (global) | yes | **200** | 80 | 8% | 28 | 797 ms |
| `sc1.maid.zone` (DE) | yes | **200** | 79 | 18% | 24 | 789 ms |
| `sc3.maid.zone` (US) | yes | **200** | 79 | 18% | 24 | 993 ms |
| `sc2.maid.zone` (JP) | yes | **200** | 80 | 15% | 22 | 1672 ms |
| `sc.opnxng.com` (SG) | no | 404 | — | — | — | — |
| `soundcloak.thoughtcrime.st` (US) | no | 404 | — | — | — | — |
| `soundcloak.nadeko.net` (US) | no | 404 | — | — | — | — |
| `sc.bloat.cat` (DE) | — | 200 but not JSON | — | — | — | — |
| `sc2.bloat.cat` (DE) | — | 301 | — | — | — | — |

Zero failures across 320 parsed tracks on the five that work. Set it as, for example:

```
SOUNDCLOUD_API_BASE=https://soundcloak.tijn.dev/_/api/v2
```

## Three things the table does not say

**`sc.maid.zone` is a trap.** It answers `/_/info` with `EnableAPI: true` and then returns a
0-byte `404` from **Caddy** for every `/_/api/v2/*` path — the edge blocks what the app
advertises. It is also not on the official instance list; the real ones are `sc1`/`sc2`/`sc3`.
Trust the request, never the capability flag.

**Some results are previews, and how many depends on the instance.** SoundCloud serves
preview-gated tracks that look like ordinary ones and report `duration: 30000` — the hazard
`docs/BLOCKED.md` already names. It ranges from 4% to 18% *for identical queries*, which
means it is a property of how the instance authenticates rather than of the catalogue.
Timbre does not currently mark them, so a 3-minute song can arrive as a 30-second one.

**Pointing at someone else's instance moves the exposure, it does not remove it.** Your
deployment's requests, and the taste of everyone using it, arrive at a stranger's server;
their `client_id` scraping is what makes it work, and their operator carries that. The
comment in `.env.example` about moving the technique to you assumes you run it. Running your
own from the AGPL source is the only version where the answer to "who is doing this" is you.
