# Changelog

What changed in Timbre, written for whoever is listening to it rather than for whoever
built it. Timbre has one tagged version, `0.1.0`; the entries under it are dated
development milestones from the week before it, newest first.

Everything Timbre knows about you lives in your browser. Nothing in here ever moved that
somewhere else.

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
