import { findBiography, type BiographyQuery } from "@/lib/biography";

import { ExternalIcon } from "../icons";
import { BiographyProse } from "./biography-prose";

export async function ArtistAbout(query: BiographyQuery) {
  const bio = await findBiography(query);
  if (!bio) return null;

  // The summary arrives as one string with the article's own paragraph breaks still in it.
  // Printing it whole was a wall of text; the breaks are free and they are where they belong.
  const paragraphs = bio.extract
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <section className="mb-7 sm:mb-9">
      <h2 className="mb-3 px-1 text-[length:var(--text-title)] font-extrabold tracking-[var(--track-title)]">
        About
      </h2>

      <div className="slab rounded-[var(--r-lg)] bg-[var(--surface-1)] px-5 py-4 sm:px-6 sm:py-5">
        <BiographyProse paragraphs={paragraphs} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[length:var(--text-meta)]">
          <a
            href={bio.url}
            target="_blank"
            rel="noopener noreferrer"
            className="press inline-flex items-center gap-1.5 font-semibold text-[var(--fg)] hover:underline"
          >
            Read {bio.title} on Wikipedia
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
