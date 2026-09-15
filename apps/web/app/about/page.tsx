import Link from "next/link";

import { getEnv, hasSoundCloud } from "@/lib/env";
import { sourceStyle } from "../sources";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "About Timbre",
  description:
    "What Timbre is, what it deliberately does not do, and who actually serves the music.",
};

/* /about and /privacy are the app's two prose pages and share this scale exactly, so moving
   between them does not feel like moving between two sites. Everything comes off the type ramp
   in globals.css rather than a hand-picked `text-lg`: the section heads step down from the page
   title by a defined amount instead of by whatever looked right. Held as constants because
   privacy/page.tsx carries the identical set — the twin is deliberate, not a stray copy. */
const SHELL = "mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6";
const TITLE =
  "text-[length:var(--text-display)] font-extrabold leading-tight tracking-[var(--track-display)]";
const HEAD = "text-[length:var(--text-section)] font-bold tracking-[var(--track-title)]";
const BODY = "text-[length:var(--text-body)] leading-relaxed text-[var(--fg-dim)]";
const STRONG = "font-semibold text-[var(--fg)]";
const BULLETS = "ml-4 list-disc space-y-2 marker:text-[var(--fg-faint)]";
const LINK = "font-semibold text-[var(--fg)] underline underline-offset-2";

const SOURCES = [
  {
    id: "ytmusic",
    href: "https://music.youtube.com",
    role: "Search and playback. Every song you hear plays inside YouTube's own embedded player, so views and ad revenue reach the rights holder exactly as they would on YouTube itself.",
  },
  {
    id: "audius",
    href: "https://audius.co",
    role: "Search and playback, and one of the two sources Timbre plays itself — Audius publishes audio with no player to embed, so the sound comes out of Timbre's own audio element rather than someone else's window. Nothing is downloaded or copied; the audio streams from Audius, and the listen is counted for the artist. Its catalogue is the unsigned half of music: remixes, edits, bootlegs and DJ sets that were never released anywhere else.",
  },
  {
    id: "archive",
    href: "https://archive.org/details/etree",
    role: "Live recordings, suggested rather than searched, and the other source Timbre plays itself. The Live Music Archive holds concert tapes uploaded with the performing band's permission — the clearest licensing of anything here. It only answers for bands that allow taping, so it stays quiet unless what you are playing is one of them.",
  },
  {
    id: "deezer",
    href: "https://www.deezer.com",
    role: "Identity and artwork. Deezer publishes ISRCs — the recording industry's track identifiers — which is what lets Timbre recognise that two search results are the same song.",
  },
  {
    id: "apple",
    href: "https://music.apple.com",
    role: "Charts and availability, from the public iTunes catalogue.",
  },
];

/* `id` + scroll-mt so every heading is linkable and lands clear of the sticky top bar. */
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <h2 className={HEAD}>{title}</h2>
      <div className={`mt-2.5 space-y-3 ${BODY}`}>{children}</div>
    </section>
  );
}

export default function AboutPage() {
  const sources = [
    ...SOURCES,
    {
      id: "soundcloud",
      href: "https://soundcloud.com",
      role: hasSoundCloud(getEnv())
        ? "Search and playback. Tracks play in SoundCloud's own player, so the play is counted for the uploader exactly as it would be on soundcloud.com. Catalogue search is on for this deployment; it is off by default, because it needs a client_id the operator has to supply."
        : "Playback only, on this deployment. Paste a SoundCloud link into the search box and it plays, in SoundCloud's own player. What is missing is the catalogue search, which the operator has not turned on — so Timbre can play a SoundCloud track you already found, but cannot find one for you.",
    },
  ];

  return (
    <div className={SHELL}>
      <h1 className={TITLE}>About Timbre</h1>
      <p className={`mt-2 ${BODY}`}>
        A music player for people who don&rsquo;t pay for streaming. One search box and one
        queue across the free catalogues that already exist.
      </p>

      <Section id="what-it-does" title="What it does">
        <p>
          You search once. Timbre asks several music services at the same time, works out
          which results are the same song, and shows you one row per song rather than four
          near-duplicates. Playing it starts the track inside that service&rsquo;s own
          player, and the queue moves on by itself when it ends.
        </p>
        <p>
          Playlists are yours and stay on this device. Nothing Timbre remembers about you
          is stored anywhere else, because there is no database to store it in. Your
          searches do pass through this site on their way to the catalogues — that is how
          searching works, and{" "}
          <Link href="/privacy" className={LINK}>
            the privacy page
          </Link>{" "}
          says exactly what is and is not kept.
        </p>
      </Section>

      <Section id="background-playback" title="Music stops when your phone locks">
        <p>
          This is the limitation worth knowing before you rely on it, so here it is first
          rather than buried.
        </p>
        <p>
          <strong className={STRONG}>On a computer</strong>, Timbre keeps playing in a
          background tab, exactly like any music site. <strong className={STRONG}>On a phone</strong>
          , locking the screen or switching apps stops the music, and there are no
          lock-screen controls.
        </p>
        <p>
          The reason is structural rather than an oversight. The audio is not Timbre&rsquo;s
          — it plays inside the music service&rsquo;s own embedded player, and background
          playback there is a paid feature of that service. Timbre could only work around
          it by breaking the rules that let it embed the player at all, so it does not.
        </p>
      </Section>

      <Section id="what-it-wont-do" title="What it deliberately doesn't do">
        <p>
          These are not missing features. Each one is a rule Timbre keeps in order to stay
          a legitimate way to listen.
        </p>
        <ul className={BULLETS}>
          <li>
            <strong className={STRONG}>It hosts no audio.</strong> Nothing is stored, copied
            or relayed through a Timbre server. Every stream comes from the service it
            belongs to, over your own connection.
          </li>
          <li>
            <strong className={STRONG}>No downloading</strong>, and no offline copies.
          </li>
          <li>
            <strong className={STRONG}>The video stays visible.</strong> Stripping the
            picture to leave audio alone is prohibited, so Timbre shows the player rather
            than hiding it behind its own controls.
          </li>
          <li>
            <strong className={STRONG}>No ad blocking.</strong> Whatever the service would
            play, it plays. That is how the artist gets paid.
          </li>
        </ul>
      </Section>

      <Section id="sources" title="Who actually serves the music">
        <p>
          Timbre is a shell around other people&rsquo;s players. The catalogues, the
          streams and the artwork are theirs.
        </p>

        {/* White cards with an ink edge on the blush page — the card treatment the references
            draw, and the one thing on this page that should look like an object rather than
            prose. They sit on `--surface-1` rather than the blush `--surface-2` so the stack
            separates from the background by tone as well as by outline.

            The underline is gone from the source name and moved to hover: six permanently
            underlined links in six different brand colours is the decoration this page did not
            need, and the colour already says the word is a link. */}
        <ul className="space-y-2.5">
          {sources.map(({ id, href, role }) => {
            const { label, color } = sourceStyle(id);
            return (
              <li
                key={id}
                className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-1)] px-4 py-3"
              >
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[length:var(--text-body)] font-bold underline-offset-2 hover:underline"
                  style={{ color }}
                >
                  {label}
                </a>
                <p className="mt-1 text-[length:var(--text-meta)] leading-relaxed text-[var(--fg-dim)]">
                  {role}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="not-affiliated" title="Not affiliated">
        <p>
          Timbre is an independent project. It is{" "}
          <strong className={STRONG}>not affiliated with, endorsed by, or connected to</strong>{" "}
          YouTube, Google, SoundCloud, Deezer, Apple or Spotify. Those names and logos
          belong to their owners and are used here only to say truthfully where a piece of
          music came from.
        </p>
        <p>
          Nothing here is an official client for any of them, and none of them has reviewed
          or approved it.
        </p>
      </Section>

      <Section id="wont-play" title="When something won't play">
        <p>
          Some uploads refuse to play outside their own site — the rights holder can switch
          embedding off per track. Timbre tries other copies of the same song first, and
          only gives up when every one refuses. When that happens it says so and offers a
          link to the one place the track will play.
        </p>
        <p>
          That is not a bug you can report away. It is the rights holder&rsquo;s setting,
          and it is theirs to make.
        </p>
      </Section>
    </div>
  );
}
