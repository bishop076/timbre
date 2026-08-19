# Making Spotify and SoundCloud searchable

Both sources **play**. Neither can be **searched**. This records what shipped, why the gap
exists, and every route out of it that was actually tested — including the ones that do not
work, so they are not proposed again.

*Written 2026-08-19. Companion to [BLOCKED.md](BLOCKED.md), which records what other people
gate, and [BUGS.md](BUGS.md), which records ours.*

> **Two things here were wrong within the hour, and
> [RESEARCH-2026-08-19.md](RESEARCH-2026-08-19.md) found both. Re-verified
> independently before amending:**
>
> **Part 2 gives the Spotify track id as the reason search did not ship. It is
> obtainable, free and keyless** — MetaBrainz runs a resolver nobody had checked.
> `labs.api.listenbrainz.org/spotify-id-from-mbid` answers `200` with
> `Access-Control-Allow-Origin: *`, so it is callable from the visitor's browser on
> the visitor's IP. Measured here end to end: Deezer's ISRC `GBAAW9500189` →
> MusicBrainz `580f4553-…` → Spotify `1qPbGZqppFwLwcBC1JQ6Vr`. See **R9** below.
>
> **R1 says "the cost is the index" and lists four accounts. A public
> [4get](https://4get.ca) instance answers JSON with no key, no card and no captcha** —
> `4get.nadeko.net/api/v1/web?s=…`. Verified here: 10 results, first Spotify id
> `1qPbGZqppFwLwcBC1JQ6Vr`. That id has now been produced by three independent
> methods, which is the strongest signal in this document.

---

## Part 1 — What shipped

| Fix | What was wrong |
| :--- | :--- |
| **Audius added** | A source that is free, keyless, unthrottled and verified on both search and playback — and the first Timbre plays *itself*, through its own `<audio>` element |
| **Live Music Archive added** | Concert recordings uploaded with the band's permission. Recommendations only: a plain query returned a 1973 Grateful Dead tape for *Fred again..*, so it is scoped to an exact `creator` and abstains otherwise |
| **Spotify made playable** | The embed and its metadata need no developer app. `manual` playback: the embed exposes no play API, so the queue rests until the reader presses it |
| **SoundCloud registered** | The provider was written months ago and never registered, so `resolveUrl` could not reach it and a pasted link did nothing |
| **`SOUNDCLOUD_API_BASE`** | Optional, unset by default. Points at an `api-v2`-shaped base the *operator* runs, which makes the catalogue searchable for self-hosters only |
| **Results ordered by playability** | `searchAll` concatenated per source, so a source whose rows never merged began at **#21**. Now round-robin within a playability tier |
| **Blank ISRC is not an id** | Audius sends an empty string, which survived `??` and became the song id — three songs shared one React key |
| **Artwork proxy and resize** | `proxied()` rewrote hosts `/api/art` would refuse; `sized()` asked for sizes a host does not serve and got 400s |
| **Radio fetched once per song** | Every fall-through attempt re-fired `/api/radio` — three calls in 1.5s for one song |
| **Fall-through list pre-fetched** | `docs/BUGS.md` B-5: resolving on failure cost fail, round trip, retry — heard as a stall |
| **Audius plays counted** | `/stream` returns `skip_play_count=true` by default; passing `false` restores the credit. Verified: play count 29,931 to 29,932 |
| **Failure messages made true** | *"Every copy blocks playback outside YouTube"* fired for songs with no YouTube copy at all |
| **Mobile: no video card for audio** | 300x200 of cover art parked over the results for a source with no picture |
| **Accessibility** | `aria-valuetext` (a screen reader read *"142"*, not *"2:22 of 4:19"*), Home/End/PageUp/PageDown on seek, and an `h1` on `/` and `/search` |
| **The paste hint** | Both sources worked and nothing said so. The placeholder offers "or a link" without saying whose |

---

## Part 2 — Why neither can be searched

They fail for unrelated reasons that are easy to conflate.

**Spotify.** Catalogue search needs a developer app. Since Feb 2026 that needs the owner to
hold Premium, allows **one client ID**, and caps Development Mode at **five users**; extended
quota wants a registered business with 250k MAU. *This is a limit on searching only.* The
embed, oEmbed and the embed page's own metadata need no developer app at all — which is why
playback shipped and search did not.

**SoundCloud.** Registration closed years ago; access is a manual review behind a paid Artist
Pro subscription. Playback needs none of it: `soundcloud.com/oembed` and the HTML5 Widget are
keyless.

---

## Part 3 — Every route, measured

### R1 · A web index, filtered to the service's own domain — WORKS

**The strongest option for both.** Spotify and SoundCloud both publish track pages that
search engines are invited to index, so the ids are already public.

Measured 2026-08-19 — a domain-scoped query returns exactly what is needed:

```
"wonderwall oasis"    -> open.spotify.com/track/1qPbGZqppFwLwcBC1JQ6Vr   (+9 more)
"Fred again Delilah"  -> open.spotify.com/track/0Ftrkz2waaHcjKb4qYvLmz   (+9 more)
"flume remix"         -> soundcloud.com/flume/hyperparadise-flume-remix  (+9 more)
```

Neither service's API is touched. SoundCloud's `robots.txt` explicitly permits general
crawlers on UGC and forbids only `/search`; Spotify's track pages are indexed for SEO.

**The cost is the index.** Timbre has none, and every free-tier search API is a vendor
decision that can be withdrawn — three died in the 18 months to Feb 2026 (Bing retired,
Google's Custom Search closed to new signups and dies Jan 2027, Brave's free tier became
metered). The survivors with recurring free allowances and no card: **Exa** (about $10/mo of
credit, roughly 1,400 searches), **Linkup** (about 4,000/mo), **Firecrawl** (1,000
credits/mo). **Serper** gives 2,500 one-time with no card and is Google's own index — the
right way to *measure* hit rate before committing to anything.

**Verdict: build when wanted.** One optional env var, the same shape as
`SOUNDCLOUD_API_BASE`: unset, nothing changes; set, both catalogues become searchable.

### R9 · MetaBrainz's own resolver — WORKS, keyless, browser-callable

**Added 2026-08-19 after `RESEARCH-2026-08-19.md` F-1, and independently re-measured.**
The route this document said did not exist:

```
Deezer /search -> /track/{id}.isrc            already a registered provider
MusicBrainz /ws/2/isrc/{isrc}   -> mbid       13/15 in F-1
labs.api.listenbrainz.org/spotify-id-from-mbid -> id   10/15, all 10 rendered correctly
```

Every hop keyless; the last sends `Access-Control-Allow-Origin: *`. There is also a
**metadata variant** that skips MusicBrainz entirely when the album is known — and Deezer
supplies the album, so for a merged song it is *one* call rather than two:

```
/spotify-id-from-metadata/json?artist_name=Oasis&release_name=(What's the Story) Morning Glory?&track_name=Wonderwall
  -> ["0A6sqSxlqml1wjQLjuM4BH", "1qPbGZqppFwLwcBC1JQ6Vr"]      verified here
```

It requires all three of artist, release and track — artist plus track alone is a `400`.

**Why it is more trustworthy than a free tier:** it is a non-profit's dataset, published so
ListenBrainz can export its own playlists. The reason it exists is structural, not generous —
unlike Odesli's, which went away. But the labs host is **not SLA'd** and neighbouring
endpoints were seen returning `500` under load, so every call must abstain on failure the way
the ranker already treats an absent list.

**SoundCloud gets nothing from it — 0/15.** The endpoint exists and answers; the index is
empty for that material. R1 remains SoundCloud's only route to track URLs.

**Where it goes:** not into search. Two extra calls per *song* is fine; per *result row* is
not. It belongs on the song being played — resolve the Spotify id for the current track and
offer the panel, which is what `PLAN.md` always described as "see where else a song lives,
and hand off".

### R2 · An api-v2-shaped base the operator runs — SHIPPED, SoundCloud only

`SOUNDCLOUD_API_BASE` points at something the operator runs — a
[soundcloak](https://github.com/maid-zone/soundcloak) instance exposes an allowlisted reverse
proxy at `/_/api/v2` with the `client_id` injected server-side. The technique this project
declined stays in someone else's AGPL repo, on their IP, by their choice. Unset by default;
the hosted build never calls `api-v2`.

**No Spotify equivalent exists.** There is no soundcloak for Spotify — the projects in that
space (Spotube, spot, psst) are *clients* that need your own account, not proxies standing
between you and the service.

### R3 · The user's own Spotify account (PKCE) — CAPPED AT FIVE

Works end to end, and is not blocked by the id: a user authorises Timbre with their own
account using Authorization Code + PKCE — no client secret, safe in a browser — and Timbre
calls `/search` with *their* token.

**Capped at five users.** That is a property of the app, not the deployment, so it cannot be
grown by self-hosting more copies; each operator would register their own Spotify app and get
their own five seats. The owner must also hold Premium, which collides with the standing
non-goal.

**Verdict: viable for a personal or self-hosted build, never for a hosted one.**

### R4 · Running the official Spotify app in the background — MECHANISM REMOVED

The idea is sound and the mechanism is gone.

Spotify's desktop client used to be a local web server — **SpotifyWebHelper** on
`127.0.0.1:4370`, with `spotilocal.com` resolving to loopback so a web page could reach it.
Several libraries wrapped it (`spotify-local`, `spotify-locally`,
`spotify-desktop-remote`). **Spotify removed it and replaced the functionality with the Web
API**, and those libraries are unmaintained.

Not testable here — Spotify is not installed on this machine — so this is recorded as
*removed per its own ecosystem's documentation*, not as *measured absent*. **If you have
Spotify installed, this is worth ten minutes:** run it, then probe 4370-4380 for
`/service/version.json?service=remote`. A live helper would be a better answer than anything
else in this document, because it needs no developer app and no token.

What replaced it — **Spotify Connect** — controls a running client through the *cloud* Web
API, so it needs a token and collapses into R3.

### R5 · Spotify's own search page — NO IDS

`open.spotify.com/search/{q}` answers 200 and renders **zero** track ids server-side —
156KB of HTML, none. It is client-rendered behind an authenticated call. Fetching it buys
nothing.

*(By contrast the **embed** page does server-render everything — title, artists, duration,
cover, `isPlayable` — which is what the Spotify provider reads. That works only once you
already have the id.)*

### R6 · Impersonating the Spotify web player — CLOSED TO A BROWSER

Nuclear's Spotify plugin mints anonymous tokens at `open.spotify.com/api/token` behind a TOTP
signature, with hardcoded rotating secrets. **A browser cannot follow it:** that endpoint
sends no `Access-Control-Allow-Origin`, and the headers the technique depends on — `Origin`,
`Referer`, `User-Agent` — are
[forbidden header names](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name)
script cannot set. Nuclear manages it because its requests come from Rust.

Routing it through a Next.js function instead puts **Timbre's** server and IP behind the
impersonation, and a TOTP signature added expressly to authenticate a first-party client is
the cleanest section 1201 fact pattern in this area. **Closed road, not a gap.**

### R7 · Extracting streams — OUT

Out for both, and not close: DRM for Spotify, and Spotube received a cease and desist in 2025
for combining Spotify metadata with third-party audio. Timbre's whole position is that it
hosts nothing and extracts nothing.

### R8 · A browser extension, or a local companion app — COSTS AN INSTALL

An extension running *on* `open.spotify.com` is first-party — no CORS, no token, full search.
A companion app the reader installs can hold their own credentials and expose them over
loopback, which is how YTMDesktop works.

Both **cost an install**, which is the line the product is drawn on: Timbre is a website.
Kept here because they are the only routes that reach 100%, not because they are recommended.

---

## Part 4 — What to do

1. **R9 for Spotify** — keyless, browser-callable, no account anywhere, and variant-aware
   because neither hop is a fuzzy match. Lazily, on the song being played rather than on
   every search row.
2. **R1 for SoundCloud**, which R9 cannot serve, pointed at a public 4get instance rather
   than a paid tier — same optional-env-var shape as `SOUNDCLOUD_API_BASE`. One trap
   recorded in F-4 and worth repeating: **the `site:` operator returns zero results there.**
   Phrase the query (`Oasis Wonderwall spotify track`), do not scope it.
3. **If Spotify is installed, probe 4370-4380 anyway.** Ten minutes, and a live local helper
   would still beat both.
3. **R3 stays a self-host note.** Five seats is a demo, not a feature.
4. **Nothing else here should be reopened** without new evidence — each was tested, and the
   reasons they fail are structural rather than temporary.

Until one of those lands, the honest framing is the one the search box now uses: *Timbre can
play a SoundCloud or Spotify track you already found, and cannot find one for you.*
