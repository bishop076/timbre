# Blocked

Things Timbre cannot do because someone else gates them. `docs/BUGS.md` logs
*our* defects; this logs *their* gates, so the two never get confused.

Each entry: what is blocked · what blocks it · what would unblock it · when it was
last checked.

Status: `BLOCKED` · `DECLINED` · `DEFERRED` · `REGRESSED`

---

## SoundCloud catalogue search `BLOCKED` — and why SoundCloud is not shipped

*Checked 2026-08-15.*

**Blocked by:** open registration closed years ago. Access is case-by-case via an
application form, requires a paid **Artist Pro** subscription, is manually
reviewed over weeks, and is not guaranteed.

**Not blocked:** playback. `soundcloud.com/oembed` and the HTML5 Widget API need
**no credentials at all**, and the whole integration is written and verified —
`packages/providers/src/soundcloud.ts`, `apps/web/app/player/soundcloud-player.tsx`,
`app/api/resolve/route.ts`. Position advances, duration reads, attribution is
correct.

**Why it is still unshipped.** Without search, the only way a track enters Timbre
is a user pasting a URL they already found on soundcloud.com. That is a SoundCloud
badge in the UI that almost nobody could ever trigger. **A source you cannot search
is not a source**, so it is registered nowhere and invisible to every code path:
`searchAll` skips it via `searchable: false`, and `resolveUrl` only walks
*registered* providers.

**Unblocked by:** approval. Then set `searchable: true` in `soundcloud.ts` and add
`registerProvider(createSoundCloudProvider())` in `apps/web/lib/providers.ts`.
**No other code changes** — `packages/providers/src/types.ts` was designed for a
provider that is playable but not searchable.

**Free to start now:** the application costs nothing to submit and the latency is
the whole problem, so filing it early is strictly better than filing it later.

---

## SoundCloud via extracted `client_id` `DECLINED`

*Considered 2026-08-15. Recorded so it is decided once.*

**It works.** Every functioning SoundCloud integration does the same thing:

- **yt-dlp** fetches `https://soundcloud.com`, scans `<script>` tags in reverse for
  `client_id\s*:\s*"([0-9a-zA-Z]{32})"`, caches it, re-extracts on 401/403, and
  calls `api-v2.soundcloud.com`. Full `/search/tracks`, `/resolve`, `/tracks/{id}`.
- **`soundcloud-scraper`** (npm, usable directly in this stack) does the same via
  `SoundCloud.keygen()`, handling rotation automatically.

**Declined because:**

- SoundCloud's API terms explicitly forbid accessing the API without registering,
  reverse engineering, and circumventing data-security measures. This is inside
  all three.
- client_ids rotate, so it needs live re-extraction to stay working.
- ~15,000 calls/day ceiling per id.
- **Auryo** — the Electron SoundCloud desktop client — did exactly this and is
  **discontinued**: SoundCloud blocked OAuth tokens issued from its App ID and it
  broke. This is not a hypothetical risk.

**The honest tension.** Timbre already takes this posture with YouTube Music:
`ytmusicapi` is unauthenticated and rides YouTube's private InnerTube API for
search, while playback goes through the sanctioned IFrame player —
`apps/ytmusic/app/routes/search.py` says so outright. Declining the same technique
for SoundCloud is therefore **a choice about SoundCloud, not a principle the
project holds**. Recorded rather than smoothed over.

Note that even on this route playback would stay sanctioned: the Widget still
streams from SoundCloud with their branding and play counts. The extraction only
answers *"which track is this"*.

---

## Spotify `DEFERRED`

*Checked 2026-08-15.*

**Playback is not the blocker.** `open.spotify.com/embed/track/{id}` needs no key.
But it is `playback: "manual"` — the embed exposes **no play API**, so it cannot be
script-started. That is the embed's actual surface, and it is also what keeps it
clear of Developer Terms §IV.2 on blending streams. It can only ever be a separate
attributed panel, never a queue member. `types.ts` already defines `"manual"` for
exactly this.

**The blocker is the track id**, which is no longer obtainable for free (see
below).

**Catalogue search is further out of reach than the roadmap assumed.** Feb 2026:
Premium became mandatory for Development Mode, the test-user cap dropped 25 → 5,
and extended quota now requires a registered business with **250k monthly active
users**. Unblocked only by paying, which collides with the standing non-goal of
paying for developer accounts.

---

## Cross-service discovery `REGRESSED`

*Checked 2026-08-15.*

**Odesli / Songlink shut its public API down on 31 July 2026** — the whole
`v1-alpha.1` namespace now returns `410 Gone`. It was the one free, keyless way to
map a song onto its equivalent on another service, by URL or by ISRC.

**This is the root cause of both gaps above.** Even with free embeds for SoundCloud
and Spotify, there is now no free way to learn *which* track to embed.

**Checked and rejected as replacements:** MusicBrainz is genuinely free and
keyless and is ISRC-indexed, but its SoundCloud and Spotify links are
predominantly **artist-level profile URLs**, not per-track, so it cannot answer
"this recording on that service". Commercial replacements exist with free tiers in
the low hundreds of requests per month — nowhere near enough, and they reintroduce
a paid dependency.

---

## Facts worth not rediscovering

Each of these cost time to establish.

- **`soundcloud.com/oembed` returns `200` with no credentials.
  `api.soundcloud.com/oembed` returns `401`.** Most documentation and search
  results cite the `api.` host, which makes free embedding look impossible when it
  is not.
- **SoundCloud uploaders can disable embedding per track** via the Permissions
  tab, so it has the same per-track refusal problem as YouTube. `soundcloud.ts`
  returns `null` on 403/404 for this reason.
- **Plays from third-party embeds count toward the artist** and appear in
  Insights. Embedding is invited, not merely tolerated — SoundCloud ships a
  Share → Embed flow for every public track.
- **Embeddability cannot be determined server-side on YouTube.** A barred upload
  still answers oEmbed `200` and reports `playableInEmbed: true`. Only the embedded
  player knows, by trying. See `docs/BUGS.md`.
- **A VPN changes YouTube's behaviour.** Invidious' documentation states YouTube
  blocks datacenter and VPN IP ranges. If playback goes flaky, check whether a VPN
  is active before assuming a code bug.
- **That blocking hits video *delivery*, not search — which is why Timbre can be
  hosted on a datacenter IP at all.** Worth stating precisely, because the line
  above reads as a blanket ban and was nearly taken as one. Invidious'
  [error documentation](https://docs.invidious.io/youtube-errors-explained/)
  separates the two: a blacklisted IP produces `403`s on `googlevideo.com`
  videoplayback URLs, while "other functions such as viewing channels pages may
  still work". Invidious suffers badly because it **proxies video through its own
  server**. Timbre never does: the sidecar only ever fetches metadata, and
  playback runs in the visitor's browser on *their* residential IP via the IFrame
  player. The ToS rule that Timbre hosts nothing puts it on the surviving side of
  this line — a structural accident worth not undoing.
  Corroborating: `ytmusicapi`'s tracker has no cluster of "search broke on my
  VPS" reports, and its environment-dependent issues are all *authenticated*
  ones (cookies going `logged_in: 0` on headless servers). Timbre calls
  `YTMusic()` with no credentials, so there is no cookie to invalidate. The real
  guest-session limit is volume — yt-dlp's wiki puts it near 300 items/hour.
  **Still verify empirically before launch**; this is an argument that the risk
  is small, not evidence that it is zero.

---

## Apple Music similar/related tracks `BLOCKED`

*Checked 2026-08-15.*

**Blocked by:** the endpoint does not exist. The public iTunes Search API and the
Marketing Tools RSS feeds offer search, lookup and charts — there is no related,
similar, radio or continuation endpoint at any tier. The Apple Music API proper
has them, and needs a paid Apple Developer membership plus a signed JWT.

**Consequence:** Apple contributes nothing to recommendations. It abstains rather
than guessing, and the ranker treats a missing list as no evidence rather than as
evidence against. Apple still contributes charts, artwork and availability.

**Unblocked by:** paying for a developer membership, which is a standing non-goal.

---

## Deezer track-level related tracks `BLOCKED`

*Checked 2026-08-15.*

**Blocked by:** `GET /track/{id}/related` is not a route on Deezer's API. It
answers `InvalidQueryException` code 600, not 404 — worth knowing, because it
reads like a malformed request rather than a missing feature.

**Not blocked:** `/artist/{id}/related` (similar artists), `/artist/{id}/top` and
`/artist/{id}/radio` all work keylessly. So Deezer can only start a radio from an
**artist**, never from a track, which is why `RadioSeed` carries both a source id
and an artist name.

**Also worth not rediscovering:** `/artist/{id}/radio` is a deep-cuts feed. Seeded
on *As It Was* it shared **zero** tracks with YouTube Music's lists, while
`/artist/{id}/top` shared six. Timbre uses `/top`, because a list nothing else
agrees with cannot contribute to a consensus score. See
[RECOMMENDATIONS.md](RECOMMENDATIONS.md).
