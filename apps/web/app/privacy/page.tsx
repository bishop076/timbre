import Link from "next/link";

export const metadata = {
  title: "Privacy — Timbre",
  description: "What Timbre stores about you, which is nothing, and what the services it embeds can see.",
};

/**
 * The privacy policy.
 *
 * **Required, not optional.** YouTube's API Services Terms oblige every client
 * that embeds their player to publish one, so this page is a condition of using
 * the player at all — the same class of obligation as keeping the video visible.
 *
 * It is short because the truthful version is short: there is no server-side
 * store, no account and no analytics. The part that needs care is the opposite
 * of the usual one — not admitting what Timbre collects, but being clear that
 * embedding someone else's player means **they** can see the reader, and that
 * Timbre cannot speak for them. A policy that said "we collect nothing" and
 * stopped there would be technically true and materially misleading.
 *
 * Written in plain language on purpose. It describes what the code does, and
 * the code is the thing it has to keep matching.
 */

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

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6 sm:px-7">
      <h1 className="text-2xl font-extrabold tracking-tight">Privacy</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--fg-dim)]">
        The short version: Timbre has no account system, no database and no analytics.
        Everything it remembers about you is stored by your own browser, on your own
        device.
      </p>

      <Section title="What Timbre stores">
        <p>
          Your playlists, listening history, volume, and profile name and picture are kept
          in your browser&rsquo;s local storage. They are never sent anywhere. There is no
          Timbre server holding them, because Timbre runs no database at all.
        </p>
        <p>Two consequences follow, and both cut in your favour and against it:</p>
        <ul className="ml-4 list-disc space-y-2 marker:text-[var(--fg-faint)]">
          <li>Nobody — including whoever runs this site — can look up what you listened to.</li>
          <li>
            Clearing your browser data deletes all of it permanently, and it does not
            follow you to another device. Use <strong className="font-semibold text-[var(--fg)]">Export</strong>{" "}
            in{" "}
            <Link href="/library" className="font-semibold text-[var(--fg)] underline underline-offset-2">
              your library
            </Link>{" "}
            to keep a copy.
          </li>
        </ul>
      </Section>

      <Section title="What it does not do">
        <ul className="ml-4 list-disc space-y-2 marker:text-[var(--fg-faint)]">
          <li>No accounts, sign-ins, email addresses or passwords.</li>
          <li>No analytics, tracking pixels or advertising identifiers.</li>
          <li>No cookies set by Timbre.</li>
          <li>Nothing is sold or shared, because nothing is collected.</li>
        </ul>
      </Section>

      <Section title="The services Timbre embeds can see you">
        <p>
          This is the important part, and it is the one thing Timbre cannot promise on
          anyone else&rsquo;s behalf.
        </p>
        <p>
          When a song plays, it plays inside that service&rsquo;s own embedded player,
          loaded directly from them into your browser. Your device talks to{" "}
          <strong className="font-semibold text-[var(--fg)]">them</strong>, not through
          Timbre. They can therefore see your IP address, your browser, and what you played
          — and if you are signed in to that service in the same browser, they may connect
          it to your account there. They may set their own cookies.
        </p>
        <p>
          That is governed by their privacy policies, not this one. The same applies to
          artwork, which is loaded from the service that published it.
        </p>
        <ul className="ml-4 list-disc space-y-1.5 marker:text-[var(--fg-faint)]">
          <li>
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold text-[var(--fg)] underline underline-offset-2"
            >
              Google / YouTube privacy policy
            </a>
          </li>
          <li>
            <a
              href="https://soundcloud.com/pages/privacy"
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold text-[var(--fg)] underline underline-offset-2"
            >
              SoundCloud privacy policy
            </a>
          </li>
        </ul>
      </Section>

      <Section title="What the server sees">
        <p>
          Searching sends your search words to this site&rsquo;s server, which asks the
          music services on your behalf and returns the merged results. Those searches are
          not logged to any database and are not linked to you.
        </p>
        <p>
          Search results are briefly held in memory — a couple of minutes — so that many
          people looking up the same song do not each cost a separate request to services
          that strictly limit how often they may be asked. That cache holds public
          catalogue information about songs, not about people.
        </p>
        <p>
          Requests are counted per network address for a minute at a time, purely to stop a
          runaway script exhausting those limits for everyone else. Those counts live in
          memory and are discarded continuously.
        </p>
        <p>
          The host running this site keeps its own standard server logs, as any web host
          does.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Timbre is not directed at children and collects nothing from anyone, of any age.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this ever changes, this page changes with it — and any change that meant
          Timbre started collecting something would be a change to how the app works, not
          only to its wording.
        </p>
      </Section>
    </div>
  );
}
