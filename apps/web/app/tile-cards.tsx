"use client";

import Link from "next/link";

import { Artwork } from "./artwork";
import { Equalizer } from "./equalizer";
import { PlayIcon } from "./icons";
import {
  COVER_EMPTY,
  COVER_NOTE,
  TILE_BOX,
  TILE_SUBTITLE,
  TILE_TITLE,
} from "./song-card";

export function ReleaseCard({
  href,
  coverUrl,
  title,
  subtitle,
  eager,
}: {
  href: string;
  coverUrl: string | null;
  title: string;
  subtitle: string;
  eager?: boolean;
}) {
  return (
    <Link href={href} className={`group w-full ${TILE_BOX}`}>
      <div className={`slab-sm press overflow-hidden rounded-[var(--r-md)] ${COVER_EMPTY}`}>
        <Artwork
          src={coverUrl}
          eager={eager}
          className="aspect-square w-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
          surfaceClassName={COVER_EMPTY}
          noteClassName={COVER_NOTE}
          iconClassName="size-8"
        />
      </div>
      <span title={title} className={TILE_TITLE}>
        {title}
      </span>
      <span className={TILE_SUBTITLE}>{subtitle}</span>
    </Link>
  );
}

export function ArtistCard({
  href,
  name,
  imageUrl,
  subtitle = "Artist",
  onPlay,
  playing = false,
  eager,
}: {
  href: string;
  name: string;
  imageUrl: string | null;
  subtitle?: string;
  onPlay?: () => void;
  playing?: boolean;
  eager?: boolean;
}) {
  return (
    <div className={`group relative w-full ${TILE_BOX}`}>
      <div className="relative">
        <Link href={href} className="block rounded-[var(--r-full)]" aria-label={name}>
          <div
            className={`slab-sm press aspect-square overflow-hidden rounded-[var(--r-full)] ${COVER_EMPTY}`}
          >
            {/* No picture for an artist is the ordinary case, not a failure — most of what gets
                here comes from local history, which never carried one. So it gets a mark rather
                than a fallback: the initial, in the same accent the empty cover blooms with. A
                note glyph in a circle would say "this artist's photo is missing"; a letter in a
                circle is just what an artist without a photo looks like. */}
            {imageUrl ? (
              <Artwork
                src={imageUrl}
                eager={eager}
                className="size-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
                surfaceClassName={COVER_EMPTY}
                noteClassName={COVER_NOTE}
                iconClassName="size-8"
              />
            ) : (
              <span
                aria-hidden
                className={`flex size-full items-center justify-center text-2xl font-extrabold tracking-[var(--track-display)] ${COVER_NOTE}`}
              >
                {initial(name)}
              </span>
            )}
          </div>
        </Link>

        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play ${name}`}
            title={`Play ${name}`}
            className={`slab-sm tint absolute bottom-0 right-0 z-20 flex size-10 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-fg)] transition duration-300 ease-[var(--ease)] ${
              playing
                ? "translate-y-0 opacity-100"
                : "translate-y-2 opacity-0 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            }`}
            style={{ background: "var(--accent)" }}
          >
            <PlayGlyph playing={playing} />
          </button>
        )}
      </div>

      {/* Duplicate of the picture link above, for the mouse only — hidden from readers so the
          artist is not announced twice over. */}
      <Link href={href} tabIndex={-1} aria-hidden className="block">
        <span title={name} className={TILE_TITLE}>
          {name}
        </span>
        <span className={TILE_SUBTITLE}>{subtitle}</span>
      </Link>
    </div>
  );
}

/** First letter that carries any meaning — `Array.from` so an emoji or an accent survives. */
function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "♪";
}

export function PlayGlyph({ playing }: { playing: boolean }) {
  return playing ? (
    <Equalizer className="h-3.5 gap-[3px]" />
  ) : (
    <PlayIcon className="size-[18px] translate-x-px" />
  );
}
