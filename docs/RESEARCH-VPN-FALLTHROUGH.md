# The VPN fall-through: what actually breaks, and what fixes it

Measured 2026-08-20 from this machine, which is exiting in **Switzerland**
(`cloudflare.com/cdn-cgi/trace` gives `loc=CH`, `colo=ZRH`). That is the same condition
`RESEARCH-2026-08-20.md` G-16 measured, so this is a second, independent sample of it, and
it lands on a different conclusion because it drove **Timbre** rather than YouTube.

## G-16 measured YouTube. This measures the app, and the app fails earlier

G-16 walked candidates through the IFrame API directly and found 6 of 12 songs with every
copy barred. Playing one of those six through Timbre shows what a listener actually gets:

```
search "blinding lights the weeknd", play the first row (YT Music)
  footer          "All 5 copies on YouTube block playback"
  audio element   none            - no preview fallback ran
  other sources   none tried
  final state     unplayable
```

**The ladder stops at YouTube**, and the reason is structural rather than a missing rung.
Every rung below the first reads `song.sources`:

| rung | reads | result for this song |
|---|---|---|
| another YouTube candidate | `candidates.current` | 5 tried, all barred |
| `progressiveOf(song)` | `song.sources` | absent |
| `spotifyIdOf(song)` | `song.sources` | absent |
| `soundcloudUrlOf(song)` | `song.sources` | absent |
| `previewOf(song)` | `song.sources` | absent |

The song played is a YouTube-only merge, *Blinding Lights (Official Video)*, so **every rung
after the first is empty by construction.** Meanwhile the same search returned
`Blinding Lights - The Weeknd - After Hours` on **SoundCloud** as a separate row, because the
two did not merge. The copy was on screen and the ladder could not reach it.

## The rescue already exists. It is wired to the wrong path

`load()` already searches every source and adopts a plausible match's sources - that is what
rescues a history row with nothing to play (`5e66598`). `handleError()` never calls it. So
the app can recover a song that arrives with *no* playable source, and cannot recover one
whose only source turned out to be barred, which is the harder and more common case.

**The fix is to run the same rescue when the YouTube candidates exhaust**, before giving up.
No new mechanism, no new request shape, and it is B-4's "other-source ladder" finally
reaching the rung B-4 never built.

## What that buys, measured against the six songs G-16 found fully barred

SoundCloud search is now enabled (`SOUNDCLOUD_DIRECT_API`, `aa5a5ca`), which G-16 could
still assume away. Every one of the six is covered, at **full length** - `SNIP` rows are
already dropped, so these are genuinely playable - and the count is candidates that pass
Timbre's own `plausiblySameSong` guard, not raw hits:

| song, all-barred on YouTube | SoundCloud rows | pass the guard | first match |
|---|---|---|---|
| Blinding Lights - The Weeknd | 19 | **10** | *Blinding Lights* by The Weeknd |
| As It Was - Harry Styles | 19 | **15** | re-uploads |
| Wonderwall - Oasis | 20 | **15** | *Wonderwall* by Oasis |
| Shape of You - Ed Sheeran | 20 | **16** | *Shape of You* by Ed Sheeran |
| Rolling in the Deep - Adele | 19 | **14** | re-uploads |
| Smooth Operator - Sade | 17 | **12** | re-uploads |

**6 of 6, and three of them lead with the artist's own upload.** G-16's honest floor was
"30 seconds via the preview"; with the ladder able to leave YouTube it is the whole song.

## Two things that cannot be built, tested so nobody tries

**Pre-filtering by advertised availability does not work.** The obvious optimisation is to
skip candidates the territory bars instead of discovering it one `loadVideoById` at a time.
YouTube does publish the data, and it is wrong for this purpose:

```
video 4NRXx6U8ABQ (Blinding Lights), fetched from this CH exit
  availableCountries   246 codes, CH present
  playableInEmbed      true
  status               OK
  actual embed here    BARRED, error 153
```

`BUGS.md` already records that `playableInEmbed` lies. This adds that `availableCountries`
lies in the same direction: **watch availability and embed permission are different
restrictions**, and only the second one matters here. There is no field to filter on.

**The error code is not a reliable signal either.** From a bare page the six candidates all
returned **153**, which is undocumented and is not in `youtube-player.tsx`'s
`blockedUpload = [100, 101, 150]` - so it would count as not worth retrying and would stop
the ladder at the first copy. In-app the same song walked five candidates, so it received a
retryable code there instead. **The code depends on the embedding context**, which means it
cannot be used to detect a territorial block - but 153 should be added to `blockedUpload`
anyway, because the one context that produced it is one where the ladder would have died
immediately.

## One thing that is cheaply knowable: which country you are exiting in

```
GET https://www.cloudflare.com/cdn-cgi/trace     Access-Control-Allow-Origin: *
loc=CH   colo=ZRH
```

Keyless, CORS-open, readable from the browser. That is enough to turn the current sentence -
*"All 5 copies on YouTube block playback"*, which asserts a cause nobody checked and is false
here - into one that names the real one. G-16 proposes a control-video load to distinguish
the cases; this is a cheaper first signal, and the two compose: a control load says *the
territory*, `loc` says *which*.

## Recommended, in order

1. **Call the `load()` rescue from `handleError()` when candidates exhaust.** Fixes 6 of 6,
   at full length. Smallest change, largest effect, and it is B-4's own named remedy.
2. **Add `153` to `blockedUpload`.** One line; without it, any context that reports 153 gets
   no fall-through at all.
3. **Say what actually happened.** `loc` plus G-16's control load, so the message stops
   asserting an unverified cause - the mistake B-6 exists to record.
4. Do **not** build a pre-filter on `availableCountries` or `playableInEmbed`. Both say this
   video is fine. It is not.

## Unsettled

Whether these six are barred from every VPN exit or only `CH` - one exit is one sample, and
G-16 says the same. The recommendation does not depend on it: rung 1 helps whenever YouTube
exhausts, for any reason, including an ad blocker or a dead upload.

Whether the guard-passing SoundCloud candidates play under this VPN was not driven end to
end here. The widget reported `MONETIZE` and full duration from this exit in G-16, which is
the same signal the provider reads, but that is inference and not a played second.
