import { findBiography, type BiographyQuery } from "@/lib/biography";

import { ExternalIcon } from "../icons";

export async function ArtistAbout(query: BiographyQuery) {
  const bio = await findBiography(query);
  if (!bio) return null;

  return (
    <section className="mt-6 sm:mt-9">
      <h2 className="mb-2.5 px-1 text-lg font-extrabold tracking-tight sm:mb-3.5 sm:text-xl">About</h2>

      <div className="slab rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-4">
        <p className="line-clamp-4 max-w-prose text-sm leading-relaxed text-[var(--fg-dim)]">
          {bio.extract}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
          <a
            href={bio.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex items-center gap-1.5 font-semibold text-[var(--fg)] hover:underline"
          >
            More on Wikipedia
            <ExternalIcon className="size-3" />
          </a>
          <p className="text-[var(--fg-faint)]">
            From Wikipedia,{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noopener noreferrer license"
              className="underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--fg-dim)]"
            >
              CC BY-SA
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
