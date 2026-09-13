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
variant) now runs `scripts/free-port.mts 8787` before uvicorn. It lists *listening*
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

---

## B-18 · A refused media server is a stall, not an error, and the ladder never ran `FIXED`

**Severity:** critical from an affected network — a spinner at 0:00 on every YouTube track, for ever

| | |
|---|---|
| **Symptom** | Hosted build, any YouTube Music track: the bar shows a spinner at `0:00`, the embed shows YouTube's own loading ring, and nothing changes for as long as the tab is open. No error in the log, no fall-through, no preview. Reported as "not adblocker friendly" — and the ad blocker was innocent: plain Chrome with no extensions did exactly the same. |
| **Cause** | From a Datacamp VPN exit, YouTube's player accepts the video (`playabilityStatus: OK`, 24 formats) and then **googlevideo.com answers every `videoplayback` request with 403**. The player re-fetches its config every 1.5s and alternates `UNSTARTED` and `BUFFERING` with `videoLoadedFraction` exactly zero. **`onError` never fires.** Every rung of the ladder hangs off `handleError`, so a failure without an error left the whole ladder unreachable. |
| **Fix** | `youtube-player.tsx` arms a ten-second stall check on every load, cancelled by any settled state (`PLAYING`, `PAUSED`, `CUED`, `ENDED`) or by `onError`. If the player is still `UNSTARTED`/`BUFFERING` with nothing buffered and the position at zero, it reports `handleError(…, true, { stalled: true })`. `handleError` treats a stall as a refusal of the *address* rather than the upload and skips the song's other YouTube copies — they are served by the same edge — going straight to progressive, SoundCloud, the rescue, Spotify and the preview. The decision itself is `youtube-stall.ts`, tested. |

**Why it hid.** The same address on a plain-http origin gets a clean error `150` at
once (`UNPLAYABLE, "This video is unavailable"`), so local development showed a coded,
retryable failure and the ladder worked. Only the https deployment got as far as the
media server, and only there did the failure lose its code. B-6's rule — log the
number, never the sentence — could not help; there was no number. The stall log line
carries the player state instead.

**What it cannot do.** Ten seconds is a timeout, not a detection: a very slow start
that has buffered nothing at all in ten seconds is abandoned too, the same bargain
SoundCloud's `STALL_MS` makes at seven. And on the hosted build, where
`SOUNDCLOUD_DIRECT_API` is off by design, leaving YouTube lands on the catalogue's
thirty-second preview — a clip with a badge saying so, rather than a spinner saying
nothing. The whole song from such a network needs SoundCloud search turned on or a
different exit; see RUNNING.md.

Measured 2026-08-30: *As It Was* and *Blinding Lights*, hosted build, Chrome headless
and Brave with uBlock Origin — 7 × 403 on `videoplayback` each, no `onError` in 45s.

---

## B-19 · The embed host decides whether a distrusted network gets media at all `FIXED`

**Severity:** critical from an affected network — every YouTube track fell through to a clip

B-18 made the failure visible and bounded; this is what the failure was.

| | |
|---|---|
| **Symptom** | From a VPN exit, every YouTube track in the hosted build stalled (B-18) and fell through to a preview — while **youtube.com itself played in the next tab**, same VPN, same ad blocker. |
| **Cause** | Not the address. An anonymous, cookie-less first-party watch page played from the same exit in headless Chrome. What was refused was the *embedded player* on `www.youtube.com`: `playabilityStatus: OK`, then googlevideo.com answering 403 to the media, in the app, in a bare `<iframe>`, and through the IFrame API alike. |
| **Fix** | `youtube-player.tsx` passes `host: "https://www.youtube-nocookie.com"` to `YT.Player`. Measured under the real hosted origin with the component's exact sequence: `www.youtube.com` → UNSTARTED/BUFFERING for ever, 5–6 × 403; `youtube-nocookie.com` → PLAYING, fourteen seconds in after sixteen, every media request 200. `frame-src` names both hosts because the API script still loads from `www.youtube.com`. |

**How it was found.** The reader's report that a plain YouTube tab worked on the same
network ruled out the address, so the contexts were compared one variable at a time from
the same exit: first-party watch page (plays), embed under the hosted origin (stalls),
the same embed on the privacy-enhanced host (plays), a plain iframe on each host (same
split). Four variants, one difference.

**What is still true.** A `127.0.0.1` origin gets error `150` on *both* hosts, so this
cannot be seen in local development at all — the probe has to run under a public origin,
which a Playwright route can fulfil without deploying. And the media servers' judgement is
YouTube's and can change; if the stall returns on the new host, B-18's fall-through is
still underneath it.

---

## The 2026-09-05 review

Five read-only passes over the whole tree — player, core and providers, the web routes, the
client stores and views, the sidecar and tooling — with every finding re-verified against the
code before it was touched. Everything below is `FIXED` and has a test where the area has a
test file. Nothing was measured in a browser; these are defects the code states on its own
terms, in the way B-11 and B-12 were.

## B-20 · A song re-loaded onto itself never restarted `FIXED`

**Severity:** high — repeat-one hung on a spinner at the end of every song

`load` clears every player handle and the `attempt*` that follows sets one back, in the same
synchronous batch. For the song already loaded that is the value the handle already had, so
React reconciled nothing and no player's load effect re-ran: nothing called `loadVideoById`
or `audio.play()`. Repeat-one reached it on every song's end, repeat-all on a one-song
queue, Previous on the first song, and picking the playing song again from a list. The
context now has `restart`, which seeks to zero and starts the player that is already there;
`goTo`, `advance`, `play` and `handleEnded` use it whenever the target is the loaded song.
The callers that know the player has ended say so, because YouTube's `ENDED` never reaches
`handleStateChange` and the context still reads "playing" at that moment.

## B-21 · Every fall-through cancelled the radio seed, and nothing asked again `FIXED`

**Severity:** high — the queue died at its end for any song whose first copy refused

The radio effect is keyed on the player handles so that every source re-seeds, and its
cleanup aborted the request. A fall-through changes a handle for the *same* song, so it
aborted the seed — and `seededFor`, set at the top of the effect, then stopped the re-run
from asking again. *Wonderwall*, whose first three uploads refuse in 1.5s, got no radio at
all. The cleanup now aborts only when the song has changed, read off `songRef`, which `load`
sets before any state this cleanup could observe.

## B-22 · SoundCloud's refusals were final, though the file said otherwise `FIXED`

**Severity:** high — a song on four sources was given up on because SoundCloud was tried first

`soundcloud-player.tsx` documents `soundcloudTried`, the once-per-song guard that lets it
report a refusal as worth retrying. The guard had never been added to `player-context.tsx`,
so the player kept reporting `false` and `handleError` returned at the top: no search, no
rescue, no Spotify, no preview. It exists now, cleared in `load` and set in
`attemptSoundCloud`, the SoundCloud rung checks it, and the player reports what is true.

## B-23 · An interrupted `audio.play()` was reported against the next song `FIXED`

**Severity:** medium — skipping away from a buffering Audius track walked the next song's ladder

`play()` rejects with `AbortError` when the source changes under it. Only `NotAllowedError`
was filtered, so the rejection reached `handleError` after `songRef` had moved on, and the
song *after* the skip fell back to another copy mid-load — or was declared unplayable — for
a failure it never had. The effect's cleanup now marks the attempt cancelled, and an
`AbortError` is ignored regardless.

## B-24 · A source badge on the playing song wiped the queue `FIXED`

**Severity:** medium — choosing a source discarded everything queued after the song

Badges call `play(song, [], source)`, which replaced the queue with `[song]`. Picking another
source for the song already playing — the badges' documented purpose — threw away the rest
of the queue and the radio continuation, and disabled Previous. `play` now keeps the queue
when the song asked for is the one loaded and only a source was named.

## B-25 · Concurrent acquisitions all passed the rate limiter `FIXED`

**Severity:** high — Apple's 403 throttle was reachable from a single search

`RateLimiter.acquire` is `load → consume → save`, and nothing serialised it within a
process: every concurrent caller read the same state before any wrote, so twenty
acquisitions against a five-token bucket resolved at once. Deezer's adapter fans out several
requests in parallel and two searches share one bucket per provider, so this was the normal
case, not a race in the edge sense. Acquisitions are now chained per key; a failed one does
not stall the callers behind it. Tested.

## B-26 · Four ways the title parser produced a wrong key `FIXED`

**Severity:** medium-high — live cuts merging into studio takes, reissues never merging

`normalize.ts`, all measured on real titles:

- A segment with a guest credit returned before the variant patterns ran, so *Wonderwall
  (Live with Orchestra)* and *Blinding Lights (Remix feat. Rosalía)* had no variant and
  merged with the studio take on nothing but the duration guard — the one thing the module
  exists to prevent. The credit is now the tail of the segment, and the rest is classified.
- `from "…"\b` needed a word character after the closing quote, so a soundtrack credit was
  never stripped and *Let It Go (From "Frozen")* never merged with *Let It Go*.
- Two overlapping reissue patterns left residue: *(Remastered Version)*, *(Deluxe Version)*
  and *(30th Anniversary Edition)* kept a `version` or a `30th` as a variant. One pattern now.
- Noise was stripped from anywhere in the main title, so *Clean*, *Audio* and *Special*
  reduced to an empty base — every such song by one artist shared a key, and LRCLIB was
  asked for an empty track name — and *Stereo Hearts* lost its front. Only a trailing run
  of noise comes off the main title now.

## B-27 · A track carrying an ISRC was filed by title into a group without one `FIXED`

**Severity:** medium — two songs sharing one id, which is the collision the id exists to prevent

`mergeTracks` took the first group `matches` accepted. A track whose ISRC belonged to the
second group matched the first on its title, and both came out with the ISRC as their id —
duplicate React keys and a broken lookup. A group already holding the track's ISRC is now
found before any title match. Tested.

## B-28 · One malformed cached chart row bricked the home page `FIXED`

**Severity:** high — S-1 again, one store over

`charts-cache.ts` said "shape-checked" and checked `Array.isArray`, exactly what
`importPlaylists` did before S-1. A `null` in `timbre:charts` threw during render on `/`,
before the fetch that would have overwritten it, so it came back on every visit, and the
only way out deleted every playlist too. The check `playlists/store.ts` grew for S-1 is now
`song-shape.ts`, shared by both stores, and applied on write as well as read. Tested.

## B-29 · Two Spotify refreshes spent one single-use token `FIXED`

**Severity:** medium — the Spotify section vanished about an hour into a session

PKCE refresh tokens rotate. `accessToken` had no in-flight guard, and it is called per
search *and* on the SDK's own schedule, so two callers finding the same lapsed token both
spent it and the loser was refused with `invalid_grant`, which read as "not connected". One
refresh at a time now. Alongside it, in the same module: the Spotify search fired per
keystroke with no debounce (now 300ms, like the blended search), a token response that was
not JSON surfaced a `SyntaxError` instead of the status, the callback page ran the exchange
twice under StrictMode and reported "started in a different tab" over a connection it had
just saved, and a refused sign-in left the verifier in session storage.

## B-30 · `/api/art` relayed SVG from Timbre's own origin `FIXED`

**Severity:** medium — an allowlisted host serves what its users upload

The type check was `startsWith("image/")` and the upstream type was echoed back.
`image/svg+xml` passes both and is an XML document that may carry a `<script>`; opened
directly, it would run with this origin's storage — playlists, profile, Spotify tokens. SVG
is refused, and the refused-body paths now cancel the upstream body rather than leaving the
socket to garbage collection.

## B-31 · Smaller fixes from the same review `FIXED`

- **player** — candidates `load` already found for a song not on YouTube Music were never
  walked on failure; `enqueue` appended to the render-time queue instead of the ref; the
  progress wave flashed full on the first play (its clock began at page load, and counted
  time paused); the volume slider stayed in a drag after `pointercancel`; a rejected player
  API script was memoised as rejected for the rest of the session.
- **stores** — the "saved" tick's close timer in the playlist menu fired after the reader had
  moved on and pulled focus back; a cross-tab picture change arriving mid-load was dropped.
- **api** — `z.coerce.boolean()` made `?full=0` and `?alternatives=false` mean yes
  (`queryFlag`, the four spellings `env.ts` accepts); `/api/radio` validated a `source` it
  never used; `/api/lyrics` promised caching and set no header; the collection page decoded
  an already-decoded param and threw a `URIError` — a 500 where a 404 belongs.
- **providers** — a caller's own abort was wrapped as "unreachable" and a token was spent
  for a caller already gone; three Spotify fetches bypassed the deadline every adapter must
  carry.
- **sidecar** — `/radio` at `limit=50` asked for 51 and fetched a continuation, which the
  model's own comment says it must not.
- **tooling** — the pre-commit hook skipped renamed-and-edited files (`--diff-filter` had no
  `R`) and read commented-out imports as real; the sidecar Dockerfile installed from open
  ranges rather than `uv.lock` (**not built here** — no Docker or uv on this machine — so the
  `uv export` line is written from its documentation and needs one build to confirm).

**Left alone, on purpose:** the sidecar shares one `requests.Session` across concurrent
requests despite `client.py` saying it must not — the concern is the code's own and is
unproven, so it is noted rather than changed. `DEPLOY.md` said CI builds the sidecar image
on every release; `release.yml` builds only the web one. Corrected in `DEPLOY.md` with B-32.

---

## B-32 · A radio response outlived the song it was fetched for `FIXED`

**Severity:** medium — another song's recommendations could be appended under the wrong song

B-21 stopped a fall-through cancelling the radio seed, and in doing so left the request
without an owner. The effect's re-run for the same song returns at `seededFor` before it
registers a cleanup, so once the handle had changed nothing held the controller: the next
song's load could not abort it, and its response, arriving late, was adopted into whatever
queue was current. Skip away from a song mid-seed and its recommendations could land under
the song after it.

The controller now lives in a ref. Loading a different song, `stop` and unmount abort it,
and the response checks both its signal and the song it was fetched for before touching the
queue. A same-song fall-through still keeps the request alive, which is what B-21 was for.
Found by the integration review on `codex/claude-review`, 2026-09-05.

---

## B-33 · YouTube's bot wall arrived as error 150, and the ladder walked every copy `FIXED`

**Severity:** high from an affected network — every YouTube and YT Music track fell through, slowly and without a reason

B-19 made the embed host the fix for one network; this is the next network, where no host helps.

| | |
|---|---|
| **Symptom** | From a VPN exit, every YouTube track spun through several copies and landed on a 30-second preview with no word why. The log blamed each upload's owner: *"The owner disabled playback on other sites."* |
| **Cause** | The address, not the uploads. Measured 2026-09-10 from a Datacamp exit in Kuala Lumpur, under the hosted origin: every video's player response was `LOGIN_REQUIRED: "Sign in to confirm that you're not a bot"`, on `youtube-nocookie.com` and `www.youtube.com` alike, YouTube's own API sample `M7lc1UVf-VE` included — and the anonymous first-party watch page got the same wall with 403s on the media. The embed reports all of it as `150`, which the ladder read as per-upload and walked. The Singapore exit B-19 was measured from played the same probe five days earlier. |
| **Fix** | `youtube-refusal.ts`: one coded refusal (101/150/153) may still be the upload's, two different uploads of one song refused in a row is the connection, and the ladder then leaves YouTube as it already did for a stall. The three codes share one sentence that names no cause. When YouTube turned the connection away, the player bar says so beside the preview badge, and the give-up message says so instead of counting copies. |

**What this does not fix.** Nothing on this side makes a refused address play: YouTube judges
the viewer's IP, and datacenter VPN exits pass or fail by server. The remedies are the
reader's — another exit, or YouTube routed outside the VPN. The trade taken here is that a
song whose first two uploads are genuinely owner-barred no longer reaches a third that
would have played; the rescue across sources is still underneath it.

**How to see it.** A `127.0.0.1` origin gets `150` on both hosts regardless, so local
development shows nothing. Read `playabilityStatus` from the `youtubei/v1/player` response
under the hosted origin, as B-19 did, and compare the first-party watch page from the same
exit before touching the player.

---

## B-34 · A blocked player script skipped the ladder built for exactly that `FIXED`

**Severity:** high wherever `youtube.com/iframe_api` is filtered — nothing played at all, though four other sources would have

B-33 taught the ladder to leave YouTube when the *network* turns it away. This is the case
where YouTube never answers in the first place, and the ladder was never asked.

| | |
|---|---|
| **Symptom** | With an ad blocker or a network filter on `youtube.com/iframe_api`, every song stopped after eight seconds on *"Couldn't load YouTube's player. An ad blocker or network filter may be blocking it."* SoundCloud, Audius, Archive, Spotify's embed and the 30-second preview were all reachable and none was tried. |
| **Cause** | `youtube-player.tsx` reported the blocked-script timer as `handleError(reason, false)`. `worthRetrying: false` is `handleError`'s "give up now" path — it sets `unplayable` and returns before the first rung. So the one failure the fall-through ladder exists to survive was the one failure that bypassed it. `mixcloud-player.tsx` and `spotify-player.tsx` said `false` for the same reason; only `soundcloud-player.tsx` had it right. |
| **Fix** | All three now report a blocked player as retryable. YouTube additionally reports `{ blocked: true }`, and `whyLeftYouTube` returns `"blocked"` — a verdict on YouTube entire, not on the copy. That distinction is not cosmetic: with no API script there is no player object for `start` to drive, so a second video id does not fail, it hangs at `loading` with nothing left to raise an error. Leaving outright sends the ladder to progressive → SoundCloud → rescue → Spotify → preview, which is where it should have gone at eight seconds. |

**The second half, found by fixing the first.** The eight-second timer runs once per *mount* of
`YouTubePlayer`, and leaving YouTube unmounts it. So the verdict was reached for one song and
then thrown away: the next song to reach YouTube found `playerRef.current` still `null`, and the
effect that drives `videoId` returns silently when there is no player — no timer left, no error,
`loading` for ever. That was already true before this fix, one song later. `apiBlocked` now holds
the judgement for the page rather than the mount, and is cleared if the script does arrive late,
so a slow network cannot strand a stale verdict.

**Why the message changed too.** `youtubeTurnedAway` was a boolean, so the player bar said
*"YouTube refused this connection"* for both causes. For a blocked script that is B-6's
mistake again — asserting a cause the app never verified, and one that sends the reader to
their VPN settings over an extension. It now carries which of the two it was, and the bar and
the give-up message read from it.

**Observed, 2026-09-13, not just reasoned.** Driven in Chrome against a dev build, with
`https://www.youtube.com/iframe_api` blocked at insertion so the script never executes — the
same shape as an extension, and confirmed by `window.YT` staying `undefined`. First song:
verdict at +8s from the player mounting, then the ladder walked and *As It Was* played from
SoundCloud, reached through the rescue rung since the song carries only `ytmusic` and `apple`.
Player bar read "SoundCloud · YouTube's player is blocked here". Second song (`Coming Up Roses`,
`ytmusic` only): reported at **1.1s, not 8s** — the `apiBlocked` path — and gave up with
"YouTube's player never loaded here, and nothing else could play it," which is correct for a
song with nothing underneath it.

**What the observation caught that reading had not.** The first cut left the eight-second timer
armed on every mount, including mounts made *after* the verdict was already in. Eight seconds
after a song had finished giving up, the timer fired again and walked the whole ladder a second
time — a wasted `/api/search` and a visible flicker back through "finding a copy…". The timer is
now armed only while the verdict is still open. This is the half the write-up called least
scrutinised, and it was: reading the code found the hang, watching it found the echo.

**A third cause, as of the CSP going enforcing.** `next.config.ts` served
`Content-Security-Policy-Report-Only` until b4c2e73, so nothing it named was ever enforced.
Now an origin missing from `PLAYERS` is blocked outright and presents exactly as the ad
blocker does. `https://www.youtube.com` is in `PLAYERS` and `youtube-nocookie.com` in
`frame-src`, so this ladder is not affected today — but the give-up message names no cause
for that reason, and `POST /api/csp-report` is what tells the three apart.

**How to see it.** Block `https://www.youtube.com/iframe_api` in the browser's network
request blocking (DevTools → Network conditions) and play anything with a SoundCloud or
Audius source. Before: `unplayable` after eight seconds. After: eight seconds of YouTube,
then it plays from the next source, with *"YouTube's player is blocked here"* in the bar.
This one does reproduce on `127.0.0.1`, unlike B-19 and B-33.

---

## B-35 · Two guards outlived their attempt `FIXED`

**Severity:** low each, and both found by reading the ladder rather than by hitting them

Both are state that should have been scoped to one attempt at one song and instead lived for
the tab. Neither is a new mistake — `load` already resets six other refs beside them.

| | |
|---|---|
| **Symptom** | A song rescued onto another source once was never rescued again: meeting it a second time, it fell to Spotify's embed, a 30-second preview, or nothing. And a queue playing two Apple or Deezer songs in a row fetched radio for the first only. |
| **Cause** | `rescued` guards `adoptElsewhere` so that a rescue whose own source then fails cannot rescue again and loop — a guard for the *walk*, left standing for the session. `merge.ts:57` makes `id` the ISRC where there is one, so the same song found again in a later search carries the same id and its original broken sources, and the rescue that repaired them once declined to run. Separately, the radio effect listed six values all derived from `playing`, and a subscription embed is identified by none of them — `subscriptionTrack` was not in the list, so nothing changed between two Apple songs and `seededFor` stayed on the first. |
| **Fix** | `load` clears `rescued` with the rest. The walk-scoped guard still holds: `adoptElsewhere` sets it before `start`, so a rescued source that fails cannot rescue a second time. The radio effect depends on `playing` itself rather than on six things read out of it — one dependency cannot fall out of step with its own derivations, which is exactly how the subscription case was missed. |

**Why the radio one was nearly invisible.** Deezer and Apple report no end of track
(`STOPS_AFTER_ONE`, 0.14.5), so a queue on one does not advance by itself and their picks are
never made sticky — reaching two in a row takes deliberate pressing. The missing seed was real
but almost unreachable, which is why it survived.

---

## B-36 · Deezer answered in the language of whatever country the server sat in `FIXED`

**Severity:** high in appearance, and it quietly broke deduplication as well

| | |
|---|---|
| **Symptom** | Home billed Tame Impala as テーム・インパラ, Explore's shelves read *"Fresh in ダンス"*, and the Rankings axis was Japanese. Nothing was misconfigured and no setting could change it. |
| **Cause** | Deezer localises artist names, genre names and editorial titles to the country it geolocates the **request IP** to, and only to that. The PIA exit in use was Tokyo. `?country=US` is accepted and ignored; the only lever is `Accept-Language`, which neither Deezer caller sent. |
| **Fix** | `apps/web/lib/deezer.ts` and `packages/providers/src/deezer.ts` both send `accept-language: en-US,en;q=0.9` (`c9b6497`). |

**The second half, which nobody was looking for.** `merge.ts` keys cross-provider dedupe on
the artist name, so a Deezer track returned as テーム・インパラ never merged with its Apple
or YouTube twin. The same song appeared twice in a result list, with the two halves of its
sources split between the duplicates — so a song that had a playable copy could present as
one that did not. Fixing the language fixed the merge, which is why this is filed as a bug
rather than as a display preference.

**How to see it, and why you probably cannot.** It needs an exit outside an English-speaking
country; from a UK or US address Deezer answers in English and the defect is invisible. That
is what kept it unnoticed — it is a property of where the *server* sits, so it would have
reached production the moment a Vercel region moved. The `spotify-web.ts` caller had set the
same header since it was written; the two Deezer callers were the ones that never did.

---

## B-37 · Every Audius cover came back 403 from our own proxy `FIXED`

**Severity:** low — artwork only — but it was invisible to every check the repo runs

| | |
|---|---|
| **Symptom** | Audius rows in a search result had no artwork at all, where every other source had a cover. Nothing failed, nothing logged: `/api/art` answered 403 and `<Artwork>` drew the placeholder it draws for a song that genuinely has none. |
| **Cause** | `api.audius.co` is a **directory, not a CDN**. Asked for a cover it answers `307` to whichever community node holds it — measured live: `v.monophonic.digital`, and `cn1.mainnet.audiusindex.org` for others. `fetchAllowed` checks every redirect target against the allowlist, correctly for every other host, so the hop was refused and the route returned "Host not allowed". |
| **Fix** | `FOLLOWS_OFFSITE` lets that one host's redirect leave the allowlist, bounded by the cover path, `https`, and a private-address refusal. |

**Why following it is safe, which is the whole question.** The leak `/api/art` exists to stop
is the *browser* fetching from an unvetted host, which hands that host the reader's address
and user agent. A hop taken server-side hands it nothing about the reader — that is what a
proxy is. The bound kept instead of the hostname is the path: the redirect must still be
asking for the same shape of cover, so a caller can never steer the server anywhere beyond a
cover they could already have named.

**How it survived.** S-21 rewrote Audius covers onto `api.audius.co` precisely so they would
be proxied, and checked that the host serves the bytes — it does, to `curl`, which follows
redirects. The proxy sets `redirect: "manual"` and does not. Typecheck, lint, 341 tests and a
production build were all green with every Audius cover broken, because nothing renders an
image. It was found by opening the app and looking at the network panel.

---

## B-38 · Enforcing the CSP blocked every Spotify embed the same day `FIXED`

**Severity:** high — every Spotify-only track was unplayable in production

| | |
|---|---|
| **Symptom** | A Spotify-only track sat at 0:00 for 8s and then read *"No source here could play this one."* The console named the cause outright: *"Loading the script `https://embed-cdn.spotifycdn.com/_next/static/iframe_api.5d9c278…js` violates the following Content-Security-Policy directive: `script-src` …"* |
| **Cause** | `script-src` named `https://open.spotify.com`, the `API_SRC` constant in `spotify-player.tsx`. But that URL is **a loader and nothing else** — it injects one script from `embed-cdn.spotifycdn.com`, and that bundle is what calls `onSpotifyIframeApiReady`. The loader was allowed, the bundle refused, so the callback never fired. |
| **Fix** | `SPOTIFY_EMBED_ASSETS` adds `https://embed-cdn.spotifycdn.com` to `script-src` in `next.config.ts`. |

**This was shipped by E-14's own resolution, hours earlier.** That entry enumerated
the script origins *from the code* and said so as a virtue — "more reliable than a
console sweep". It is more reliable for the origins a constant names, and blind to
the ones a constant only *reaches*. `open.spotify.com/embed/iframe-api/v1` is the
one loader among the five that pulls its real body from a different host, and no
read of `app/player/*` can show that, because the second host appears nowhere in
this repo except in a comment in `spotify-player.tsx` that says exactly this and
was not consulted. The header was `Report-Only` for three weeks and enforcing for
a few hours; the bug is entirely the second state.

**What made it look like something else.** `giveUpReason` in `player-context.tsx`
falls through to "No source here could play this one." when a song has no YouTube
copy and nothing progressive was tried — which is true, and says nothing about
the Spotify attempt that just failed. B-33's three named codes exist for YouTube
and have no Spotify equivalent, so the one message that would have pointed here —
*this site's own policy refused the player* — is the one the UI cannot say. It is
still unsaid; only the block is fixed.

**How the other four were cleared.** Each loader was fetched and read for the
origins it injects: `sdk.scdn.co/spotify-player.js` pulls only from `sdk.scdn.co`,
both Mixcloud APIs only from `player-widget.mixcloud.com`, YouTube's `iframe_api`
only from `www.youtube.com`, and SoundCloud's two were already named by E-14 off
`layout.tsx`'s preconnects. Spotify's embed was the only gap. **Adding a player,
or seeing a player's API change, means doing this read again** — `curl` the API
URL and grep it for origins; a constant in `app/player/*` is where a script host
starts, not the set of them.
