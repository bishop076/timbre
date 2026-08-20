import Link from "next/link";

import { getEnv, hasSoundCloud } from "@/lib/env";
import { SOURCE_STYLES } from "../sources";

/**
 * **Rendered per request, not prerendered.** This page now reports whether SoundCloud's
 * catalogue search is on, and that is a runtime fact: the Dockerfile builds with no
 * SoundCloud variables set and `next start` receives them from the environment afterwards.
 * Left static, the build would bake "the operator has not turned it on" into the HTML and
 * the honesty page would keep saying it after the operator turned it on — the same staleness
 * this branch exists to end, just moved from the source to the build.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "About Timbre",
  description:
    "What Timbre is, what it deliberately does not do, and who actually serves the music.",
};

// The honesty page, carrying three obligations: attribution — every embedded service
// requires its name shown and traffic able to reach it, as a term of use — a plain
// statement of non-affiliation, and the mobile limit, since playback stops when a phone
// locks and a reader who finds that out mid-song concludes the app is broken.

/** Where a reader goes to hear the catalogue at its own source. */
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
  {
    id: "soundcloud",
    href: "https://soundcloud.com",
    // Filled in per deployment — see `soundcloudRole`.
    role: "",
  },
] as const;

/**
 * **SoundCloud's entry is the one that depends on the deployment, so it is not a constant.**
 *
 * This page's whole job is to be accurate about who serves the music, and this line had gone
 * stale: it still read *"Timbre can play a SoundCloud track you already found, but cannot
 * find one for you"*, which stopped being true when `SOUNDCLOUD_DIRECT_API` and
 * `SOUNDCLOUD_API_BASE` arrived. The README was corrected for exactly this and the About page
 * was not, so the honesty page was the last place still carrying the wrong claim.
 *
 * Written as a branch rather than re-corrected, because both sentences are true somewhere:
 * search is off in the shipped default and on here, and `hasSoundCloud` is the same test
 * `/api/health` reports.
 */
function soundcloudRole(searchable: boolean): string {
  if (!searchable) {
    return "Playback only, on this deployment. Paste a SoundCloud link into the search box and it plays, in SoundCloud's own player. What is missing is the catalogue search, which the operator has not turned on — so Timbre can play a SoundCloud track you already found, but cannot find one for you.";
  }
  return "Search and playback. Tracks play in SoundCloud's own player, so the play is counted for the uploader exactly as it would be on soundcloud.com. Catalogue search is on for this deployment; it is off by default, because it needs a client_id the operator has to supply.";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="mt-2.5 space-y-3 text-sm leading-relaxed text-[var(--fg-dim)]">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  // A server component, so the page can report what this deployment actually does rather
  // than what the default does.
  const searchable = hasSoundCloud(getEnv());

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6 sm:px-7">
      <h1 className="text-2xl font-extrabold tracking-tight">About Timbre</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--fg-dim)]">
        A music player for people who don&rsquo;t pay for streaming. One search box and one
        queue across the free catalogues that already exist.
      </p>

      <Section title="What it does">
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
          <Link href="/privacy" className="font-semibold text-[var(--fg)] underline underline-offset-2">
            the privacy page
          </Link>{" "}
          says exactly what is and is not kept.
        </p>
      </Section>

      <Section title="Music stops when your phone locks">
        <p>
          This is the limitation worth knowing before you rely on it, so here it is first
          rather than buried.
        </p>
        <p>
          <strong className="font-semibold text-[var(--fg)]">On a computer</strong>, Timbre
          keeps playing in a background tab, exactly like any music site.{" "}
          <strong className="font-semibold text-[var(--fg)]">On a phone</strong>, locking
          the screen or switching apps stops the music, and there are no lock-screen
          controls.
        </p>
        <p>
          The reason is structural rather than an oversight. The audio is not Timbre&rsquo;s
          — it plays inside the music service&rsquo;s own embedded player, and background
          playback there is a paid feature of that service. Timbre could only work around
          it by breaking the rules that let it embed the player at all, so it does not.
        </p>
      </Section>

      <Section title="What it deliberately doesn't do">
        <p>
          These are not missing features. Each one is a rule Timbre keeps in order to stay
          a legitimate way to listen.
        </p>
        <ul className="ml-4 list-disc space-y-2 marker:text-[var(--fg-faint)]">
          <li>
            <strong className="font-semibold text-[var(--fg)]">It hosts no audio.</strong>{" "}
            Nothing is stored, copied or relayed through a Timbre server. Every stream
            comes from the service it belongs to, over your own connection.
          </li>
          <li>
            <strong className="font-semibold text-[var(--fg)]">No downloading</strong>, and
            no offline copies.
          </li>
          <li>
            <strong className="font-semibold text-[var(--fg)]">
              The video stays visible.
            </strong>{" "}
            Stripping the picture to leave audio alone is prohibited, so Timbre shows the
            player rather than hiding it behind its own controls.
          </li>
          <li>
            <strong className="font-semibold text-[var(--fg)]">No ad blocking.</strong>{" "}
            Whatever the service would play, it plays. That is how the artist gets paid.
          </li>
        </ul>
      </Section>

      <Section title="Who actually serves the music">
        <p>
          Timbre is a shell around other people&rsquo;s players. The catalogues, the
          streams and the artwork are theirs.
        </p>
        <ul className="mt-1 space-y-3">
          {SOURCES.map((source) => {
            const style = SOURCE_STYLES[source.id];
            return (
              <li
                key={source.id}
                className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-3"
              >
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-bold underline underline-offset-2"
                  style={{ color: style?.color }}
                >
                  {style?.label ?? source.id}
                </a>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--fg-dim)]">
                  {source.id === "soundcloud" ? soundcloudRole(searchable) : source.role}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Not affiliated">
        <p>
          Timbre is an independent project. It is{" "}
          <strong className="font-semibold text-[var(--fg)]">
            not affiliated with, endorsed by, or connected to
          </strong>{" "}
          YouTube, Google, SoundCloud, Deezer, Apple or Spotify. Those names and logos
          belong to their owners and are used here only to say truthfully where a piece of
          music came from.
        </p>
        <p>
          Nothing here is an official client for any of them, and none of them has reviewed
          or approved it.
        </p>
      </Section>

      <Section title="When something won't play">
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
