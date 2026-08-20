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

## B-7 · Orphaned uvicorn children serve stale code `OPEN` (tooling)

**Severity:** medium for local development

| | |
|---|---|
| **Symptom** | `HTTP 500` from the sidecar with **nothing in the log**, persisting across restarts. Code verified correct when called directly in Python. |
| **Cause** | `pnpm dev:ytmusic` runs uvicorn `--reload`: a reloader parent plus a worker child. Killing the parent orphans the child, which **keeps port 8787 bound and serves the old module**. `taskkill` reports "process not found" for the dead parent while the child keeps answering, and multiple stale listeners can accumulate. |
| **Workaround** | `powershell -NoProfile -Command "Get-Process python* \| Select-Object Id,StartTime"` then kill anything older than the current run. |

**Remedy worth considering:** a `predev` step that clears port 8787, or drop
`--reload` in favour of an explicit restart.

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
