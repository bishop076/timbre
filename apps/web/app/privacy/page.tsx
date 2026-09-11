import Link from "next/link";

export const metadata = {
  title: "Privacy — Timbre",
  description: "What Timbre stores about you, which is nothing, and what the services it embeds can see.",
};

const LINK = "font-semibold text-[var(--fg)] underline underline-offset-2";

const POLICIES = [
  ["https://policies.google.com/privacy", "Google / YouTube privacy policy"],
  ["https://soundcloud.com/pages/privacy", "SoundCloud privacy policy"],
];

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
          Your playlists, listening history, volume, theme, lyrics corrections and profile
          name are kept in your browser&rsquo;s local storage. Profile pictures are larger,
          so they go in IndexedDB in the same browser. There is no Timbre server holding
          any of it, because Timbre runs no database at all.
        </p>
        <p>
          One exception, and it is a real one:{" "}
          <strong className="font-semibold text-[var(--fg)]">Timbre sets one cookie</strong>,{" "}
          <code className="font-mono text-[13px]">timbre-name</code>, holding the display
          name you chose. It exists so your own name is in the page the first time it
          paints instead of appearing a moment later. Being a cookie, it is sent to this
          site with every request — nothing else Timbre stores is. It is first-party,
          holds nothing but that name, and clearing your display name clears it too.
        </p>
        <p>Two consequences follow, and both cut in your favour and against it:</p>
        <ul className="ml-4 list-disc space-y-2 marker:text-[var(--fg-faint)]">
          <li>Nobody — including whoever runs this site — can look up what you listened to.</li>
          <li>
            Clearing your browser data deletes all of it permanently, and it does not
            follow you to another device.{" "}
            <strong className="font-semibold text-[var(--fg)]">Export</strong> in{" "}
            <Link href="/library" className={LINK}>
              your library
            </Link>{" "}
            keeps a copy of your playlists — but only those. Your history, profile name and
            pictures are not in the file, so a copy is not a full backup.
          </li>
        </ul>
      </Section>

      <Section title="What it does not do">
        <ul className="ml-4 list-disc space-y-2 marker:text-[var(--fg-faint)]">
          <li>No accounts, sign-ins, email addresses or passwords.</li>
          <li>No analytics, tracking pixels or advertising identifiers.</li>
          <li>
            No tracking cookies. The one cookie Timbre sets holds your display name and
            nothing else — see above.
          </li>
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
          {POLICIES.map(([href, label]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What the server sees">
        <p>
          Searching sends your search words to this site&rsquo;s server, which asks the
          music services on your behalf and returns the merged results. Those searches are
          not logged to any database and are not linked to you.
        </p>
        <p>
          Explore follows what you play. To do that, your browser asks this site for the
          genre and newest releases of artists in your listening history — one artist name
          per request, the same kind of request a search is. Your history itself is never
          sent; the answers are kept in your browser beside it.
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
