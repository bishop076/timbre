# Changelog

What changed in Timbre, newest first.

The dated sections below `0.1.0` are development milestones from the fortnight before
the first release, written for whoever is listening to Timbre rather than whoever built
it. Everything from `0.1.1` onwards is generated from the commit log when a release is
cut, so it is briefer and closer to the language of the change itself.

Everything Timbre knows about you lives in your browser. Nothing in here ever moved that
somewhere else.

## 0.4.4 — 6 September 2026

### Fixed

- **player** — YouTube's own title bar no longer sits over a paused video

1 further change under the hood — refactoring, docs and tests.

## 0.4.3 — 6 September 2026

### Fixed

- **player** — a radio response no longer outlives the song it was fetched for

1 further change under the hood — refactoring, docs and tests.

## 0.4.2 — 6 September 2026

### Fixed

- **ytmusic** — /radio at limit=50 asked for 51 and fetched a continuation it threw away
- **web** — a late saved-tick timer no longer pulls focus back, and two smaller ones
- **api** — a query flag is only on when it says so, and three route faults beside it
- **api** — /api/art refuses SVG, which is a document and not a picture
- **spotify** — one refresh at a time, since the token it spends is single-use
- **web** — one malformed cached chart row no longer bricks the home page
- **providers** — a caller's own abort is not the source being unreachable
- **providers** — a track carrying an ISRC joins the group that holds it
- **core** — four ways the title parser produced a wrong key
- **core** — pace concurrent acquisitions on one bucket instead of admitting them all
- **player** — five smaller faults from the same review
- **player** — a source badge on the playing song keeps its queue
- **player** — stop an interrupted audio.play() walking the next song's ladder
- **player** — keep the radio seed alive across a fall-through
- **player** — let a SoundCloud refusal fall through to the next source
- **player** — start a song over when it is loaded onto itself
- **web** — let reduced motion reach the skeletons and the spinner
- **playlists** — the actions menu opened mostly off the side of the screen
- **player** — stop the scrub bar paging the panel while you seek
- **player** — stop the volume slider scrolling the page under itself
- **player** — give the now-playing tabs the keyboard they promise

12 further changes under the hood — refactoring, docs and tests.

## 0.4.1 — 5 September 2026

### Fixed

- **player** — serve the embed from youtube-nocookie.com, which is what plays from a distrusted network

## 0.4.0 — 5 September 2026

### Added

- **web** — an original mark — the waveform timbre actually describes

## 0.3.0 — 5 September 2026

### Added

- **web** — a new mark, in the icons and at the head of the rail

### Fixed

- **tooling** — clear port 8787 before the sidecar starts, so an orphaned worker cannot serve stale code
- **player** — treat a YouTube upload that buffers nothing for ten seconds as refused
- **player** — let a player report a copy that loaded and never delivered, and leave YouTube when one does
- **web** — drop two shelf utilities that could never have applied
- **web** — stop the end columns losing a side of their tooltip
- **web** — let a long title in the player bar end in an ellipsis
- **web** — three boxes that outgrew the screen holding them
- **web** — measure the chrome instead of guessing at it
- **web** — keep the chrome out of the notch and the home indicator
- **api** — meter /api/health, and stop the display name growing without bound
- **providers** — give every upstream call a deadline
- **sidecar** — compare the shared secret as bytes, so a non-ASCII header is a 401

4 further changes under the hood — refactoring, docs and tests.

## 0.2.0 — 21 August 2026

### Added

- **player** — the source badges and Apple/Deezer/Spotify players, and a ladder that can leave YouTube
- **spotify** — search Spotify on the reader's own account, via PKCE in the browser
- **spotify** — read the track id from MusicBrainz's own streaming links
- **soundcloud** — let the operator unblock catalogue search without renting a server
- **player** — play the catalogue's own 30-second preview when nothing plays the song
- **player** — draw the Mixcloud cover full size, widget as a strip beneath
- **mixcloud** — the compact player, so its chrome stops competing with Timbre's
- **providers** — add Mixcloud — the long form, and the inverse of every other source
- **spotify** — find the track without an account, and offer it beside the song
- **spotify** — playable — as a panel the reader presses, which is the only way it can be
- **providers** — add the Live Music Archive, and give the two self-played sources one player
- **soundcloud** — searchable when the operator points it somewhere, and always resolvable
- **providers** — add Audius, the first source Timbre plays itself
- **search** — order results by playability, not by registry position

### Fixed

- **soundcloud** — read the client_id from the homepage, and make the resolver recoverable
- **player** — stop the iframe on a null id, tear down every player, and stop reading "with" as a credit
- **profile** — let Escape cancel the name editor, and keep a heading while it is open
- **api** — refuse a blank query instead of searching every source for it
- **artist** — stop printing the title again as the album under it
- **artist** — keep only whole-name credits, not fragments of the name
- **merge** — stop a guest credit splitting one recording into two rows
- **player** — require the same artist before playing a fall-through copy
- **player** — let a history row with no source repair itself instead of dead-ending
- **player** — detach the message listener Mixcloud's widget leaks per show
- **player** — remember which source played, and never substitute a stranger
- **player** — never substitute a different song when one will not play
- **mixcloud** — one click, not two — autoplay belongs in the frame URL
- **mixcloud** — set the feed before adopting the frame, and size the clock to the track
- **player** — re-seed the radio for every source, and show the song's own length
- **audius** — walk the artwork mirrors instead of showing a broken frame
- **mixcloud** — stop pausing what it just started, and drop the previous show's widget
- **search** — say "you're offline" instead of "Failed to fetch"
- **search** — say which links can be pasted, because two sources were invisible
- **a11y** — say the time, reach both ends, and give two pages a heading
- **mobile** — no floating video card for a source that has no video
- **player** — say what actually failed, and offer a way out that exists
- **player** — fetch the radio once per song, not once per attempt
- **player** — warm the fall-through list, and give archive tracks a cover
- **audius** — ask for the listen to be counted
- **merge** — a blank ISRC is not a song id
- **art** — only proxy and resize hosts that can actually serve it
- **web** — stop sending HSTS from the dev server
- **profile** — mark the display-name cookie Secure
- **ytmusic** — accept a list of shared secrets, so rotation is not an outage
- **web** — security headers, and make the charts route actually static
- **art** — re-check the allowlist on every redirect, and meter the route
- **playlists** — a bad song record can no longer brick every route

### Faster

- **mixcloud** — start the frame before the script, and use the cover form while idle

22 further changes under the hood — refactoring, docs and tests.

## 0.1.3 — 18 August 2026

### Fixed

- **playlists** — a playlist without a timestamp no longer throws on read

### Faster

- **explore** — the genre chart costs no JavaScript

2 further changes under the hood — refactoring, docs and tests.

## 0.1.2 — 18 August 2026

### Fixed

- **release** — date a release by the author's clock, not the runner's

1 further change under the hood — refactoring, docs and tests.

## 0.1.1 — 18 August 2026

### Fixed

- **docs** — three references to things that do not exist
- **release** — a breaking change in a silent type released empty notes

4 further changes under the hood — refactoring, docs and tests.

## 0.1.0 — 17 August 2026

The first release.

- **Artists have real pages.** A discography grouped into albums, EPs and singles,
  instead of one undifferentiated pile of releases.
- **An artist's name now finds the artist you meant**, not whoever happened to come back
  first from the search.
- **An album plays from the track you clicked**, not always from the top.
- **One library, however you reach it.** Saved playlists were showing up in one place and
  not another depending on the route you arrived by.
- **The save menu opens above everything else**, rather than being clipped by whatever it
  was sitting inside.
- **Search is quicker.** Songs and videos are looked up at the same time instead of one
  after the other, and two searches running at once no longer trip over each other.
- **Settings shows which build you are running** — version and commit, in the corner of
  the panel.

## 16 August 2026 — nothing jumps on load

The whole day went on the first moment after you open Timbre.

- **Your own look is back before the first frame.** Theme, colour, avatar, display name
  and your playlist and song counts are all replayed before anything paints, so the app no
  longer opens as a stranger's and then corrects itself.
- **Your profile picture stops flickering.** The small copy is decoded before it is drawn,
  and the page reserves the space it will occupy.
- **The page renders your name on the server**, so a reload never shows "Profile" for a
  frame.
- **Rejected pictures say why.** Too large, or not an image Timbre can read — instead of
  silently doing nothing.
- **Shelves reserve their space** while they load, rather than shoving the content below
  them down when they arrive.
- **Explore is in the sidebar.**
- **No player bar before you have played anything**, and larger buttons on the phone
  transport.
- **A skip counts as a play**, adding to the queue adds to the end, and the progress wave
  stops animating when nothing is playing.

## 15 August 2026 — Explore, and Timbre as an installed app

- **Explore**: the charts and what to play next, on one page, with placeholders while the
  numbers are fetched instead of an empty screen.
- **Radio**, and **one page shape for every kind of list** — an album, a playlist, a
  chart, your history — with a play button that starts at the top.
- **Search moved into a bar on every page**, keeping your query as you navigate, and
  suggesting from what this browser has actually played.
- **Timbre can be installed.** App icons, a proper name on your home screen, and the shell
  loaded from disk so it opens instantly — with an honest message when the network is gone,
  since the music itself always comes from elsewhere.
- **Settings behind one button**, with the theme picker inside it.

## 14 August 2026 — the charts

- **A ranked chart with the evidence behind every position** — which sources agreed, and
  how strongly.
- **A ranking nobody publishes**, fused from sources that each publish their own.
- **Movement arrows.** Timbre remembers where a song sat the last time you looked and
  shows how far it has climbed since. First visit shows no arrows, because there is
  nothing yet to compare against.
- **Charts you can read at a glance**: genre mix as stacked columns, a ranked bar chart,
  and a plot of where two sources disagree with each other.
- **Discover shelves**, including a set built for someone with no listening history at
  all.
- **Cover art is requested at the size it is drawn**, rather than a full-size image
  shrunk in the browser.

## 12–13 August 2026 — no accounts, and the app you can see

- **Accounts and the database are gone.** No sign-in, no server-side copy of anything. Your
  playlists, history, profile and settings are yours and stay in your browser.
- **Playlists**, saved locally, with export and import so you can move them yourself.
- **A profile** — display name, picture and banner, kept on this device.
- **Lyrics beside the player**, with a choice of version and a nudge for the timing when a
  transcript runs early or late.
- **Three themes**, remembered per browser.
- **An editable queue**, keyboard control of the transport, and scrolling over the volume
  control to change it.
- **A phone layout worth using**: its own home screen, Home/Search/Library, and a
  full-screen player with its own controls.
- **Cover art is served through Timbre**, so ad blockers can no longer hide it, and it
  bleeds into a blurred backdrop behind the page.
- **An outage reads as an outage.** "No results" and "every source is down" no longer look
  the same.
- **About and privacy pages**, saying plainly what Timbre does and does not keep.

## 10–11 August 2026 — the first playable version

- **Search across several free sources at once** — YouTube Music, Deezer and Apple's
  public catalogue — merged into one list.
- **Music plays inside Timbre** instead of linking out to somewhere else.
- **When one copy of a track refuses to play, Timbre falls through to another** rather
  than stopping.
- **Only sources that can actually play a track are offered.**
- **A visible queue**, shuffle, repeat and Up Next.
- **A theater view** for music videos, and a way back out of it.
- **Recommendations blended across sources**, ranked by how much they agree.
- **A home page with real content**, in an app shell built for a music player: sidebar,
  columns, and a player bar that keeps its proportions.
- A search result plays **one song**, not twenty copies of the same one.
