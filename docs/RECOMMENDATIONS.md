# Recommendations

How Timbre decides what to play next, why it is a ranking rule rather than a
trained model, and what would have to change for that to be the wrong call.

Written because the question *"why not use a real recommender like PaddleRec?"*
is reasonable, recurring, and has an answer that is easy to lose.

---

## The short version

**Retrieval is delegated to the services. Ranking is Timbre's.**

Every source that will answer contributes one or more *ranked lists* of what it
would play next. Those lists are merged into songs and re-ranked by a rule that
rewards **agreement between independent lists**. A song that YouTube Music and
Deezer both reach on their own is a better bet than either service's own
favourite — and that comparison is the one recommendation signal Timbre can
produce that no individual service can produce for itself.

Implementation: `packages/providers/src/recommend.ts`, tested in
`recommend.test.ts`. Fan-out lives in `registry.ts` (`recommendFrom`).

---

## Where the lists come from

| List | Source call | What it is |
| :--- | :--- | :--- |
| `ytmusic:radio` | `get_watch_playlist(videoId)` | the sequential watch queue — what plays if you do nothing |
| `ytmusic:related` | `get_song_related(browseId)` → *You might also like* | derived differently by YouTube, and it disagrees |
| `deezer:artist-top` | `/artist/{id}/top` | the seed artist's canonical hits |
| `deezer:similar-artists` | `/artist/{id}/related` → each artist's `/top` | the only list that reaches *away* from the seed's own catalogue |
| `audius:versions` | `/v1/tracks/search?query={title} {artist}` | other people's takes on the song that just played — remixes, edits, mashups |

All five are keyless and unauthenticated.

### Audius contributes a different *kind* of evidence

`audius:versions` is deliberately unlike the other four, and it is ranked near the
tail for a reason.

**It is seeded by title, never by artist.** Audius has no usable artist lookup for
the music Timbre plays — measured 2026-08-19, `/users/search` matched *The Weeknd*
to "Louis The Child", *Harry Styles* to a user called "Harry", and *Flume* to three
empty accounts squatting the name. That is not merely unhelpful in the way Deezer's
artist radio is below; it is confidently **wrong**, and would feed a stranger's
catalogue into the ranking wearing the seed artist's name.

**It scores low on consensus by construction, and that is correct.** Audius's
catalogue is the derivative layer — every result for Timbre's own suggested
searches was a remix, edit, mashup or DJ set, and **not one original**. So it
agrees with nobody almost by definition, and the consensus multiplier will keep it
where it belongs: "and here are six remixes of that" is a garnish on the ranking,
not the body of it. One list, capped at 8 versions.

**`/tracks/trending` is verified working and deliberately unused.** Explore fuses
Deezer and Apple so that agreeing on two beats charting higher on one. Audius
trending is a disjoint population — independent uploads that by construction agree
with neither — so adding it would dilute that consensus rather than enrich it. If
it is wanted, it belongs in its own shelf, which is a product decision rather than
a provider one.

**Apple contributes nothing.** The iTunes Search API has no related, similar or
radio endpoint at any price, and Apple has the tightest budget of any source
(`capacity: 5, refillPerSecond: 0.3` — roughly 20 requests a minute per IP).
**SoundCloud contributes nothing** either: its catalogue cannot be searched
without a paid account (see `BLOCKED.md`). Both abstain rather than guess, and
the ranker treats an absent list as *no evidence* rather than as evidence
against. Audius abstains the same way — `radio()` returns `[]` rather than an
empty list, because pushing one would tell the ranker Audius answered.

### Deezer: `/top`, not `/radio` — and that was measured

Deezer publishes an artist radio, and it is the obvious thing to ask for. It is
also the wrong thing. Seeded on *As It Was*:

```
/artist/5313805/radio  →  25 tracks,  0 overlap with YouTube Music's lists
/artist/5313805/top    →  25 tracks,  6 overlap
```

Deezer's artist radio is a deep-cuts feed — it returns things like *Taste Back*
and *Are You Listening Yet* that no other source surfaces. **A list nothing else
ever agrees with cannot contribute to a consensus score.** It only adds
candidates for the artist-spacing pass to sort out. The top tracks are what other
services also push, which is precisely where agreement can be measured.

---

## The scoring rule

```
score = RRF × consensus × playability
```

**RRF** — Reciprocal Rank Fusion, `Σ 1/(60 + rank)` over every list that reached
the song, ranks 1-based. It is the standard way to combine lists of different
lengths with no comparable scores, and it needs no tuning. `k = 60` is the value
from the original paper; it is what stops the top one or two positions of any
single list from dominating.

**consensus** — `1 + 0.5 × (lists − 1)`. Two lists means ×1.5, three means ×2.
Since RRF already contributes one term per list, agreement compounds. This is the
term that makes the feature worth building.

**playability** — OMV ×1.15, UGC ×1.0, unknown ×0.95, ATV ×0.8. Measured, not
guessed: over 64 uploads driven in a real browser, auto-generated art tracks were
barred from embedding ~7% of the time and official videos never were. A
recommendation that will not play is worth less. The effect is deliberately mild
— the client's fall-through ladder is the real remedy, and demoting art tracks
harder would bias the whole feature toward music videos over songs.

**Everything is multiplicative on purpose.** RRF produces values around 0.016, so
an additive bonus of any intuitive size — 0.25, say — would swamp the ranking
entirely and reduce every other term to a tie-breaker.

### What counts as "the same song" across two lists

The consensus term is only worth as much as the lookup behind it, and that lookup
used to be a single normalized key per song. It had a hole big enough to disable
the term on ordinary songs.

**Services disagree about featured artists.** YouTube Music lists *Sunflower
(feat. Swae Lee)* by Post Malone; Deezer lists *Sunflower* by Post Malone.
`dedupeKey` folds a feature into the artists, so those are two different keys —
while `mergeTracks`, which is looser, groups the two tracks into one song anyway.
The merged song therefore carried one spelling and was unfindable under the other,
and scored `lists = 1` when both services had in fact reached it. Measured on that
pair: it scored **0.0153 against 0.0156 for two fillers only one list mentioned**,
so the one song both services agreed on was ranked last of three.

So a song is now looked up by *every* name it answers to — its own, and each
source track's, since the merger keeps the rows it grouped — with an ISRC or the
exact key tried first and a looser form second: same title and variants, artist
sets that need only **intersect**. Variants stay in the key deliberately, unlike
`sameRecording`'s test: a live take inheriting the studio cut's rank would promote
whichever of the two the lists happened to disagree about.

The same lookup does the excluding, and that is the more visible half. The seed is
excluded so that Deezer's top tracks do not hand back what just played — but the
seed is credited by whichever source *played* it, which need not be the source the
radio comes back from. Every song whose feature was credited inconsistently
therefore slipped the exclusion, returned as its own first recommendation, played,
and seeded the next radio: a queue that circles a handful of tracks. That, and the
unstable song ids described in `song-match.ts`, were the two halves of "the same
song keeps playing".

### Then two passes that are not scoring

**Deduplication by title and artist.** The merger deliberately keeps a music
video and its audio track apart: *Watermelon Sugar (Official Video)* runs 189s
against the track's 174s, and beyond its 3-second tolerance those are different
recordings. That is right when the question is *"which services have this
song"* and wrong in a radio, where it shows the same song twice in twelve. The
duration guard is dropped after scoring, keeping the higher-scored copy — which
is the playable one, since playability is what separates them. This pass matches
on the names above rather than one key, for the reason given there: two copies of
a song are exactly where its title is decorated differently.

**Artist spacing.** No artist twice within any three consecutive picks. Every
service ranks an artist's own catalogue highly, so a plain sort by score reliably
returns four songs by the seed's artist. Spacing **reorders, never drops**: if one
artist genuinely owns everything left, the window yields rather than returning a
short list.

---

## Is it actually better than YouTube's radio?

Honestly measured, seeded on *As It Was*: **3 of the top 10 differ** from
YouTube's raw watch queue. The blend introduced *The Fate of Ophelia* (Taylor
Swift, reached only via Deezer's similar artists), *Satellite* (Deezer's top
tracks) and *Too Sweet* (YouTube's related panel, which its own radio ranked
lower).

So: it is not a dramatic transformation, and claiming otherwise would be
dishonest. It is a real widening — two of those three came from a service
YouTube cannot see — plus dedupe and artist spacing that YouTube's raw queue does
not do. The pool for that seed was 78 candidates, 14 reached by more than one
list and 3 by more than one service.

**If a future change makes the blend indistinguishable from a passthrough, delete
it rather than keep it for the story.** It costs a network round trip.

---

## Listening history

Stored in `localStorage` and **nowhere else** (`apps/web/app/player/history-store.ts`).
It never leaves the browser; clearing site data is a complete delete. Timbre has
no accounts, so there is no user row for a server-side history to attach to — and
the privacy posture that falls out of that constraint is better than the thing it
replaced.

It powers recall, not modelling: *Recently played*, *Because you played X* (which
gives the recommender a seed on a cold page, where nothing is playing yet), and
not re-suggesting something already queued.

It is deliberately **not** a taste model. With a single listener, item-item
co-occurrence re-derives the queues you already built and calls it discovery.
YouTube's watch queue is a co-occurrence model fit on millions of people,
delivered free in one request; reimplementing that worse, on one person's data,
is not an improvement.

---

## Why not a trained model

A recommender is two systems: **retrieval** (generate candidates) and **ranking**
(order them). PaddleRec, and every library like it, ships rankers. Five things
would have to be true before one made sense here, and the third is decisive.

1. **Multiple users.** Collaborative filtering on N=1 is curve-fitting to one
   person's month.
2. **Order 10⁴–10⁵ interactions, with negatives.** Skips, not just plays. This is
   the *easiest* item on the list — one table and one endpoint — which is exactly
   why it is the wrong thing to focus on.
3. **A candidate set Timbre owns.** It does not have one and structurally cannot.
   No service's catalogue can be enumerated; `ytmusicapi` is unofficial and paced
   at 2 requests a second; "no downloading or caching" is a standing non-goal.
   Caching metadata at catalogue scale means crawling an unofficial private API,
   which is a different product with a different legal posture. **Even with a
   million logged plays there would be nothing to rank.**
4. **Item features.** No keyless source publishes genre, mood, tempo or
   embeddings. Spotify's audio-features endpoint sits behind the same wall that
   already blocked Phase B.5. You would be training on title strings.
5. **Somewhere to run it.** Not the ytmusic sidecar — `main.py` documents it as
   stateless, credential-free and holding no database connection. A model server
   with weights and a feature store violates all of that. It is a third service,
   against a hosting plan of a hobby tier and a free Postgres.

**If 1 and 2 ever land, the right first model is still not a retriever.** It is a
re-ranker over service-supplied candidates: a handful of features (time since
last played, artist saturation, skip rate by position, hour of day), logistic
regression, trainable on thousands of rows rather than millions, degrading to the
identity function when it has nothing to say.

The scorer described above **is** that re-ranker, with hand-set weights. Ship it,
measure whether it helps, and only then consider learning the weights. That
ordering also preserves the claim that makes Timbre defensible: retrieval belongs
to the services, taste belongs to Timbre.
