# Bug log

Playback investigation, Aug 2026. Everything here concerns one symptom —
*"Video unavailable / The owner disabled playback on other sites"* — which turned
out to have **four independent causes**, three of them ours.

Status: `FIXED` · `OPEN` · `WONTFIX` · `NOT-A-BUG`

---

## B-1 · Player rendered below YouTube's minimum size `FIXED`

**Severity:** critical — broke playback on *every* track
**Fixed in:** `de15d86`

| | |
|---|---|
| **Symptom** | Bare *"Video unavailable"* on every track, in every browser. Indistinguishable from an ad blocker. |
| **Cause** | Player bar rendered the iframe at `aspect-video h-14 … sm:h-16` — **56–64 px tall, ~100×56 px**. YouTube's IFrame API documents a **200×200 minimum**; below it the player refuses to start. |
| **Fix** | `aspect-video w-full` with `style={{ minHeight: 200, minWidth: 200 }}`. 16:9 at 200 px tall is 356×200, clear on both axes. |

**Why it cost so much time:** the failure mode is a generic "unavailable" with no
error code, so it reads as an external block. `youtube-player.tsx` now carries a
comment saying exactly this. **A CSS regression that shrinks the player below
200 px silently reintroduces it** — do not shrink it at any breakpoint.

---

## B-2 · Fallback candidates were art tracks exclusively `FIXED`

**Severity:** high — ~7% of tracks unplayable, with no working alternative offered
**Fixed in:** `e6f273c`

| | |
|---|---|
| **Symptom** | Error `150` on a track; falling through to the next candidate hit `150` again, ending on *"Every copy of this song blocks playback outside YouTube."* |
| **Cause** | `routes/search.py` only ran its supplementary search when the songs filter came back thin — `if len(tracks) < request.limit`. It almost never does, so **every candidate came from `filter="songs"`, which returns art tracks (`MUSIC_VIDEO_TYPE_ATV`) essentially exclusively** — and art tracks are the class rights holders bar from embedding. Retrying fetched more art tracks, barred for the same reason. |
| **Fix** | Always also search `filter="videos"`, which is where official music videos (`OMV`) and user uploads (`UGC`) live, and merge them into the candidate list. |

Measured over 64 uploads across 15 chart songs, in a real browser driving the
IFrame API:

| Tier | n | Barred | Rate |
|---|---|---|---|
| `MUSIC_VIDEO_TYPE_ATV` (art tracks) | 45 | 3 (all code `150`) | **6.7%** |
| `MUSIC_VIDEO_TYPE_OMV` (official videos) | 19 | 0 | **0%** |

Both songs that lost an art track to a `150` had an OMV that played.

---

## B-3 · `video_type` silently dropped by the model `FIXED`

**Severity:** high — made B-2's mitigation a no-op
**Fixed in:** `e6f273c`

| | |
|---|---|
| **Symptom** | The art-track demotion added in `4c49037` had no observable effect. |
| **Cause** | `models.py:Track` had **no `video_type` field**. `normalize.py` passed `video_type=…` into the constructor and **pydantic silently discarded it**, so `track.video_type` never existed, every track compared equal, and the sort was inert. It also never reached the wire. |
| **Fix** | Added `video_type: str | None = None` to `Track`, and replaced the binary sort with an explicit rank: `OMV(0) → UGC(1) → unknown(2) → ATV(3)`. |

**Note the wrong root cause on record.** `4c49037` blamed the library:

> *"ytmusicapi usually omits videoType from search results, so that is often a
> no-op."*

**It does not.** `videoType` is populated on every result from both
`filter="songs"` and `filter="videos"`. The field simply had nowhere to land. A
silently-dropped constructor kwarg is invisible in review — pydantic's default
`extra` behaviour ignores unknown keys rather than raising.

**Ranking also decides what survives the `limit` truncation**, so without B-3
fixed, B-2's merged video results were appended and then cut straight back off.

---

## B-4 · Fall-through candidates restricted to one source `FIXED`

**Severity:** low — residual after B-2

`player-context.tsx`:

```ts
function youtubeIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
}
```

Every candidate still comes from the `ytmusic` source. B-2 fixed this *at the
sidecar* by widening what `ytmusic` returns, which is sufficient today. It
remains a structural single point of failure: if YouTube Music has no copy at
all, there is no second source to fall back to.

**Remedy if it ever matters:** other-source ladder (Spotify embed panel →
SoundCloud widget → iTunes/Deezer preview). Already a TODO at
the roadmap. Measured need: **0 of 15 songs** had every candidate
barred, so this is genuinely long-tail.

**Fixed 2026-08-20 (`57af890`), by the last rung of that same ladder.** The long tail
arrived: *Just Because of You (feat. Henneysee)* is on Apple and Deezer only, its ISRC is
too obscure for MusicBrainz so the Spotify resolver returns nothing, and all ten of YouTube
Music's answers for its title are different songs — Mark Ronson, Lloyd, YNW Melly — which
the guard correctly refuses. Everything behaved and the listener got silence.

Deezer answers `preview` and Apple answers `previewUrl` on the very search responses Timbre
already reads, so the clip costs no key and no extra request. It is the floor of the ladder
and stays there: `playback` remains `link`, so nothing about ranking or auto-advance changes
and a clip never displaces a full copy, and it is reached only after YouTube's candidates,
the progressive sources, Spotify's embed and SoundCloud have all refused. The bar reads
"30-second preview" beside the source badge — announcing a clip as the song would be a worse
answer than the refusal it replaces.

What remains true from the entry above: every *YouTube* candidate still comes from the
`ytmusic` source. What is no longer true is that a song YouTube Music does not carry has
nowhere left to go.

---

## B-5 · Candidate resolution happens after failure, not before `FIXED`

**Severity:** low — latency only

`findCandidates()` ran inside `handleError`, so a fall-through cost
fail → network round-trip → retry, which the listener hears as a stall mid-song.

**Fixed in `load()`, not in the `"resolving"` state the remedy first named.** That
state is only reached when a song has *no* direct YouTube id, and a song with one
skips straight to `attempt()` — which is exactly the path that later needs the
fall-through list. So the fetch is started alongside the first attempt instead,
unawaited, while the first copy is still loading. Fall-through now costs one
`loadVideoById`.

Two guards, because an unawaited fetch outlives the thing that started it: the
existing abort signal cancels it on a track change, and `songRef.current === song`
drops a response that lands after one anyway. `handleError` still fetches on
demand when the prefetch failed or has not landed, so nothing depends on it
arriving. Verified in a browser — playing a search result now fires
`/api/search?q=<title> <artist>&limit=10` immediately, before any error.

---

## B-6 · Error text asserts a cause the app never verified `FIXED`

**Severity:** low code impact, **high diagnostic cost**
**Fixed by Agent B**, 2026-08-17 — see the crossing note in the working notes.

`onError` now logs `[timbre] YouTube IFrame error <code> on video <id>` before it
maps anything to a sentence. The video id comes from a ref rather than the
closure: the player's callbacks are registered once, so they held the first
render's `videoId` for ever, and a log naming the wrong upload would be worse
than one naming none.

The remedy below is unchanged and is what was applied.

`youtube-player.tsx` maps error codes `100/101/150` to
*"The owner disabled playback on other sites."*

The mapping is reasonable for `101/150`. The problem is that this string was the
**only** artifact of the failure — the numeric code was never logged — and B-1 was
producing a *different* failure that surfaced with the same confident wording. The
app asserted a specific external cause for something it had not diagnosed, and the
investigation followed that assertion for a long time.

**Remedy:** always log the raw numeric `onError` code alongside any friendly text.
One integer would have identified B-1 versus B-2 immediately.

---

## B-7 · Orphaned uvicorn children serve stale code `FIXED` (tooling)

**Severity:** medium for local development

| | |
|---|---|
| **Symptom** | `HTTP 500` from the sidecar with **nothing in the log**, persisting across restarts. Code verified correct when called directly in Python. |
| **Cause** | `pnpm dev:ytmusic` runs uvicorn `--reload`: a reloader parent plus a worker child. Killing the parent orphans the child, which **keeps port 8787 bound and serves the old module**. `taskkill` reports "process not found" for the dead parent while the child keeps answering, and multiple stale listeners can accumulate. |
| **Workaround** | `powershell -NoProfile -Command "Get-Process python* \| Select-Object Id,StartTime"` then kill anything older than the current run. |

**Fixed 2026-08-27, by the first of those.** `pnpm dev:ytmusic` (and the posix
variant) now runs `scripts/free-port.mjs 8787` before uvicorn. It lists *listening*
sockets on the port — `netstat -ano` on Windows, `lsof -sTCP:LISTEN` elsewhere — and
kills each holder with its process tree, so a reloader and its worker go together
rather than the worker being re-orphaned by the script meant to clear it. It then
waits up to three seconds for the socket to be released before uvicorn asks for it,
and fails loudly if something it could not stop still holds the port. Nothing else
in the project binds 8787, so anything found there is a leftover of the previous
run by construction. `--reload` is kept: the fix is to stop losing the bind race,
not to give up hot reload.

---

## NOT-A-BUG · Verified correct, do not re-investigate

**Embeddability cannot be determined server-side.** Confirmed. A barred upload
still answers `https://www.youtube.com/oembed?…` with **200 OK** and still reports
`playableInEmbed: true` on its watch page. Only the embedded player knows, and
only by trying. `4c49037` states this correctly.

*A 41-video oEmbed sweep during this investigation returned "embeddable" for
everything, including uploads a browser then refused. The method is worthless for
this question — do not build pre-verification on it.*

**Omitting the `origin` player var on a local HTTP origin.** Correct as written;
passing it there is unnecessary and is itself a known cause of "Video unavailable".

**`net::ERR_BLOCKED_BY_CLIENT` on `generate_204` / `youtubei/v1/log_event`.**
Benign. uBlock-class blockers hit these for every user and playback continues —
they are analytics, not video delivery. Confirmed live with an ad blocker enabled.

**But `ERR_BLOCKED_BY_CLIENT` is not benign everywhere, and this note was being
read as though it were.** Measured 2026-08-20 with the blocked patterns applied
by targeted request interception:

| Source | telemetry blocked | outcome |
|---|---|---|
| SoundCloud | yes | plays — 0:06 clear, 0:08 blocked |
| Audius | yes | plays — 0:14 clear, 0:15 blocked |
| Spotify Web Playback SDK | `spclient.spotify.com` | **never registers a device** |

The SDK talks to `spclient.spotify.com` for playback control, not only for
telemetry, and uBlock-class lists block `/gabo-receiver-service` and
`/public/v3/events` by default. So the same console line means "ignore me" on
YouTube and "this will never start" on Spotify. `spotify-sdk-player.tsx` now arms
a ten-second device timeout for exactly that, because the failure is silence.

**A note on how that table was produced, because the first attempt was wrong.**
Routing `**/*` through the test harness and calling `continue()` for everything
not blocked stalled Mixcloud **5 times out of 5 with nothing blocked at all** —
the instrument was the finding. Only the blocked URLs may be intercepted; the
rest of the traffic has to be left alone.

**`Failed to execute 'postMessage' … does not match the recipient window's
origin`.** Benign race: the widget API messaging the frame before navigation
completes. Appears on working pages, including ours while audio plays.

**Falling through on `100/101/150` but not on `2`.** Correct. Code `2` is a bad
parameter of ours and retrying would loop.

---

## Timeline

| Commit | What |
|---|---|
| `de15d86` | **B-1** — player sized to YouTube's 200×200 minimum |
| `4c49037` | Fall-through on `100/101/150`; art-track demotion (inert until **B-3**) |
| `e6f273c` | **B-2** + **B-3** — always search `filter="videos"`; add `video_type` and rank properly |
| *unstaged* | **B-6** — log the numeric `onError` code; the two searches from **B-2** run concurrently |

---

## B-8 · Shuffle walked the queue in order once a pass was spent `FIXED`

**Severity:** medium — shuffle silently stopped shuffling at the end of a pass

`player-context.tsx` adopted the radio and then called `goTo(index + 1)`. Those
are the same position only when the current song is the **last** one, which is
true in order and not in shuffle: `nextIndex()` returns null from *any* position
once every song has had a turn, so playback stepped to whatever sat at `index + 1`
— a song already played — while the freshly appended recommendations sat unplayed
behind it. Repeat the pattern and it walks the queue positionally, which is
exactly what shuffle is for not doing.

`goTo(queue.length)` is the first appended song, and is identical to `index + 1`
on the ordered path, so the fix cannot regress it.

**Also:** a *skipped* song was never added to the shuffle bookkeeping — only a
song that ended was — so pressing next left it eligible to be drawn again a
moment later. The two paths now agree on what "played" means.

---

## B-9 · Caption-suppression timers accumulated for the life of the tab `FIXED`

**Severity:** low — a slow leak, no wrong behaviour

`youtube-player.tsx` pushes three delayed `unloadCaptions` retries on every
`PLAYING` event, and `PLAYING` fires on every resume as well as every track
change. Nothing ever dropped the spent ones, so an hour of listening left
hundreds of dead handles in the array — and the unmount cleanup walked all of
them. The retries only ever concern the video that just started, so the pending
set is cleared before the new one is scheduled.

**B-1 and B-2 were separate faults presenting identically.** B-1 broke everything
and was fixed first; B-2 broke ~7% and was masked underneath it. Fixing one
without the other would have looked like a partial fix in both directions.

---

## B-10 · Clearing the video id never stopped the iframe `FIXED`

**Severity:** high — the previous song kept playing over the next one

| | |
|---|---|
| **Symptom** | Pick a song that has to be looked up, and the one before it keeps playing while the bar shows the new one. If the lookup finds nothing, the old song plays on for ever under a panel reading *"No copy of this song exists on YouTube Music."* |
| **Cause** | `youtube-player.tsx` returned early on a null `videoId`. Every other source stops by *disappearing* — `now-playing.tsx` picks its player from `soundcloudUrl`, `mixcloudKey`, `spotifyTrackId` and `streamUrl`, so clearing one unmounts the component and takes the audio with it. The YouTube player is the **fallback** of that chain, mounted whenever nothing else claims the slot and therefore never unmounted, so it was the one source that could not stop itself that way. |
| **Fix** | A null id now stops the player and drops any queued id. `onStateChange` and `onError` ignore events that arrive once the id is gone. |

`load()` clears the id at the top of every track change, so the window is open on
every song that reaches the search branch — one that carries no directly playable
source. Both exits from that branch leave the id null, which is why the "for ever"
case is reachable rather than theoretical: a *Recently played* row written before
histories stored a source has no source **and no preview**, so it cannot fall to
the thirty-second clip that rescues a Deezer- or Apple-only track.

The event guards are not decoration. `stopVideo()` reports a state of its own, and
an upload cancelled mid-load can emit one after; either would have been read as the
*new* song pausing, and an `ENDED` would have advanced the queue past a track that
never played.

---

## B-11 · `stop()` tore down two players out of five `FIXED`

**Severity:** medium — latent, and only because no caller reaches it yet

`queue-ops.ts` documents `stopped` as *"the queue is now empty and the players
should be torn down"*. `stop()` cleared `videoId` and `soundcloudUrl` and left
`streamUrl`, `spotifyTrackId`, `mixcloudKey` and `playingPreview` set — and those
are the very fields `now-playing.tsx` chooses a player from, so the player stayed
mounted and playing a song no longer in the queue.

Worse where it bites: `current` is null by then, so `PlayerBar` unmounts and there
is **no transport at all** — an Audius track would simply play itself out.

Not reachable from the UI today: the queue panel only lists `queue.slice(index + 1)`,
so every `removeAt` it can issue is above the playhead and `stopped` is never
returned. It is one call site away from being reachable, and the function was wrong
on its own terms regardless.

---

## B-12 · A bare "with" in a title was read as a guest credit `FIXED`

**Severity:** medium — wrong lyrics, and a merge key that could collapse two songs

`normalize.ts` looked for `feat.|featuring|ft.|with` anywhere in a title. The first
three can only ever mean a credit; `with` is an ordinary preposition, so the middle
of a title parsed as a credit list:

| Title | Base | "Featured" |
|---|---|---|
| Stay With Me | `stay` | `me` |
| Dancing With Myself | `dancing` | `myself` |
| The Girl With The Faraway Eyes | `the girl` | `the faraway eyes` |

Three faults at once. The base is what `/api/lyrics` sends LRCLIB as `track_name`,
so those songs looked up the wrong words entirely. The noun lands in the credits,
where `normalizeArtists` compares it against real names. And the base is what a
merge is keyed on, so *Stay* and *Stay With Me* by one artist reduced to the same
key — with containment making the credits agree, three seconds of duration
tolerance was all that stood between them.

**Fix:** two patterns. The unambiguous markers are looked for anywhere; `with`
only inside a bracket or after a trailing `- `, where the segment is already known
to be an aside. `(with Ariana Grande)` — the form that does mean a guest — was
never the problem and is unaffected.

---

## B-13 · The SoundCloud `client_id` resolver could not recover, and would not stop asking `FIXED`

**Severity:** medium — opt-in path only (`SOUNDCLOUD_DIRECT_API`), off by default

Three faults in `createClientIdResolver`, all in the caching and the deadline
rather than the parsers, which were the only part under test.

**A hung upstream killed it permanently.** `fetch` has no timeout, and `inFlight`
is only cleared when the promise settles. One socket that accepted the connection
and then said nothing left it pending for ever; every later search joined the same
dead crawl, waited out the deadline and abstained. Measured: three calls, one
request, and never another. Now the whole crawl shares one `AbortSignal.timeout`,
so it always settles.

**A refusal was retried by every search.** No negative caching, and a crawl is up
to ten requests to soundcloud.com. The likeliest failure is exactly the one that
must not loop — a datacentre IP being refused, which is the normal answer for a
free serverless host — so an instance that could not resolve asked the host that
had already said no once per search for as long as it ran. Measured five requests
for five searches; now one, then a five-minute back-off.

**The deadline leaked a timer per miss.** `Promise.race` abandons the loser rather
than cancelling it, so every search that gave up waiting left a live 2.5s timer —
enough to hold a scale-to-zero container awake after it had already answered.

All three now have tests; previously only `assetScripts` and `clientIdFrom` did.

---

## B-14 · The fall-through ladder could not leave the song's own sources `FIXED`

**Severity:** high — a song with a full-length copy on screen was declared unplayable

Every rung of `handleError` below the first read `song.sources`:

| rung | reads | for a YouTube-only merge |
|---|---|---|
| another YouTube candidate | `candidates.current` | all barred |
| `progressiveOf(song)` | `song.sources` | absent |
| `spotifyIdOf(song)` | `song.sources` | absent |
| `soundcloudUrlOf(song)` | `song.sources` | absent |
| `previewOf(song)` | `song.sources` | absent |

So for a merge that carries only YouTube uploads, **every rung after the first is
empty by construction**, and the ladder had nowhere to go the moment those uploads
refused. Not a rare shape: the search's own top row for *Blinding Lights*,
*Wonderwall* and *Shape of You* is a YouTube-only merge in each case, verified
against a live index — while the same search returns the SoundCloud copy as a
separate row that did not merge. The copy was on screen and the ladder could not
reach it.

**The rescue already existed and was wired to the wrong path.** `load()` has
searched every source and adopted a plausible match since `5e66598` — that is what
repairs a history row with nothing to play. `handleError()` never called it, so
Timbre could recover a song that arrived with *no* playable source and could not
recover one whose only source turned out to be barred, which is the harder and
commoner case.

**Fix:** the selection was extracted to `adoptElsewhere` and both paths now call
it. Deliberately shared rather than copied — `advance` and B-8 are what two
hand-written copies of one sequence already cost this file. Placed above the
preview rung, since a copy that plays in full beats thirty seconds, and bounded to
one search per song by `rescued`.

The one difference between the callers is Mixcloud, and it is not a preference:
`handleError` arrives from a song that played as a *track*, so an hour-long set
sharing its name is the wrong answer — the failure `plausiblySameSong` exists to
stop, and which it catches on duration only when the show reports one, since
Mixcloud's `audio_length` is optional. `load` arrives from a song with nothing
playable at all, which is usually a pre-2026-08-19 history row for a show.

Measured beforehand from a Swiss VPN exit: 6 of 12 songs had every YouTube copy
barred, and all 6 had a full-length SoundCloud copy passing `plausiblySameSong`.
See `docs/RESEARCH-VPN-FALLTHROUGH.md`. This is B-4's named remedy finally
reaching the rung B-4 skipped.

---

## B-15 · IFrame error `153` counted as not worth retrying `FIXED`

**Severity:** medium — in the contexts that report it, the ladder stopped at the
first copy

`blockedUpload` listed `[100, 101, 150]`. Code `153` is undocumented and was in
none of them, so `worthRetrying` came back false and `handleError` returned at the
top — no second copy, no other source, no preview.

Measured 2026-08-20 from a Swiss exit: all six candidates for a territorially
barred song returned **153** from a bare page. In-app the same song reported a
retryable code and walked five candidates, which is the important half of the
finding: **the code depends on the embedding context**, so it can never be used to
*detect* a territorial block. It is added to the retry set and nothing reads it as
a cause.

`153` also got its own sentence rather than sharing 101/150's *"The owner disabled
playback on other sites"*. Those two are the owner's setting; 153 measurably is
not — it arrived on a video whose owner had left embedding on, advertising
`playableInEmbed: true` and 246 available countries. See B-6.

---

## B-16 · Two user-facing claims outlived the code they described `FIXED`

**Severity:** low impact, and the same class as B-6 — text asserting something
nobody re-checked

**"All 5 copies on YouTube block playback outside it."** Names a cause — an
uploader disabling embedding — that nothing measured. Shown, measurably, for a
song barred by territory; an ad blocker produces it too. Now reports the
observation: the copies would not play here, and nothing else could either. That
weaker second clause is deliberate — it says the ladder ran out, which is true by
construction, and not that no other source *has* a copy, which `adoptElsewhere`
may not have been in a position to establish.

**"Plays from YouTube Music, which is the only one Timbre can drive."** True when
only YouTube had a player. `PlayingSource` now has eight members.

**The About page still said SoundCloud could not be searched.** `9fe5c0d`
de-staled the README's version of this claim and missed the honesty page, which is
the one place it matters most. It is genuinely deployment-dependent — off in the
shipped default, on wherever `SOUNDCLOUD_DIRECT_API` or `SOUNDCLOUD_API_BASE` is
set — so it is now a branch on `hasSoundCloud`, the same test `/api/health`
reports, rather than a re-corrected constant.

That forced `/about` to `force-dynamic`. The Dockerfile builds with no SoundCloud
variables set and `next start` receives them afterwards, so a prerendered page
would have baked "the operator has not turned it on" into the HTML and gone stale
again the moment they did — the same bug moved from the source to the build.

---

## B-17 · The two ladders disagreed about where Spotify's embed ranks `FIXED`

**Severity:** medium — a full-length copy traded for a thirty-second clip

`load` and `handleError` are the same ladder reached from two directions, and they
had drifted on one rung. `load` holds Spotify to the bottom, below the song's own
SoundCloud copy and below the cross-source rescue, and says why at length:

> So Spotify is held rather than taken, and the search runs first. If it turns up a
> copy something can actually play, that wins. If it turns up nothing, Spotify's
> embed is still there at the bottom — which is what "last resort" was always
> supposed to mean.

`handleError` ranked it **second**, above both. So a song whose YouTube copies
refused went to the embed while a SoundCloud copy sat unread on the same song, and
B-14's rescue — which sits below — was never reached either. Both rungs are
terminal, since Spotify and SoundCloud each report not-worth-retrying, so whichever
came first got the only attempt.

**What settles it is `spotify/preview-mode.ts`.** Both orderings were arguable while
the embed was assumed to be a full song. It measurably is not: in a browser that
does not send `sp_dc` to a third-party frame — a blocker, shields, or a setting —
the embed serves **thirty seconds** to a Premium subscriber as readily as to a
stranger, and nothing on this side can change it. A rung that is sometimes a clip
cannot outrank one that is always the whole track.

Deliberately **not** gated on `spotifyPreviewsOnly()`. That flag only becomes true
after a clip has already been served once, so the first Spotify track of every
session would still be ranked as a full song and still be a clip. The order has to
be right before the evidence arrives.

`handleError` now reads: YouTube candidates → progressive → SoundCloud → rescue
(B-14) → Spotify → preview → give up, which is `load`'s order.

