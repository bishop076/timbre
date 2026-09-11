"use client";

import Link from "next/link";

import { Artwork } from "./artwork";
import { PlayIcon } from "./icons";

/*
 * The tiles that sit on shelves beside `SongCard`: a release, and an artist. Same frame,
 * same padding, same type (`.tile-card` in globals.css), so a shelf mixing kinds — "Recently
 * played" holds songs and artists — reads as one row. Each is a link to its page; a song is
 * not, because pressing a song plays it.
 */

/** An album, EP or single, linking to its page. */
export function ReleaseCard({
  href,
  coverUrl,
  title,
  subtitle,
}: {
  href: string;
  coverUrl: string | null;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="tile-card group block w-full p-2 sm:p-3">
      <div className="tile-cover overflow-hidden rounded-[var(--r-sm)]">
        <Artwork
          src={coverUrl}
          className="aspect-square w-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
          iconClassName="size-7"
        />
      </div>
      <span className="mt-2.5 block truncate px-0.5 text-[13px] font-bold sm:mt-3 sm:text-[14px]">{title}</span>
      <span className="mt-0.5 block truncate px-0.5 pb-0.5 text-xs text-[var(--fg-dim)]">{subtitle}</span>
    </Link>
  );
}

/**
 * An artist: a round picture, the way every service draws a person rather than a record. The
 * picture and the name link to the artist; `onPlay` adds a play button over the picture, a
 * sibling of the link rather than inside it — a button inside a link is two targets announced
 * as one. The name's link is out of the tab order, as `SongCard`'s title button is: one stop
 * per destination.
 */
export function ArtistCard({
  href,
  name,
  imageUrl,
  subtitle = "Artist",
  onPlay,
  playing = false,
}: {
  href: string;
  name: string;
  imageUrl: string | null;
  subtitle?: string;
  onPlay?: () => void;
  /** Something of this artist's is playing now: the button stays up and shows the bars. */
  playing?: boolean;
}) {
  return (
    <div className="tile-card group relative w-full p-2 sm:p-3">
      <div className="relative">
        <Link href={href} className="block focus:outline-none" aria-label={name}>
          <div className="tile-cover aspect-square overflow-hidden rounded-[var(--r-full)] bg-[var(--surface-2)]">
            <Artwork
              src={imageUrl}
              className="size-full transition duration-500 ease-[var(--ease)] group-hover:scale-[1.04]"
              iconClassName="size-7"
            />
          </div>
        </Link>

        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play ${name}`}
            title={`Play ${name}`}
            // Where the song tiles keep theirs: the lower right of the picture.
            className={`slab-sm tint absolute bottom-0 right-0 z-20 flex size-10 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-fg)] transition duration-300 ease-[var(--ease)] ${
              playing
                ? "translate-y-0 opacity-100"
                : "translate-y-2 opacity-0 focus-visible:translate-y-0 focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            }`}
            style={{ background: "var(--accent)" }}
          >
            {playing ? (
              <span className="eq flex h-3.5 items-end gap-[3px]">
                <span />
                <span />
                <span />
              </span>
            ) : (
              <PlayIcon className="size-[18px] translate-x-px" />
            )}
          </button>
        )}
      </div>

      <Link href={href} tabIndex={-1} className="block focus:outline-none">
        <span className="mt-2.5 block truncate px-0.5 text-[13px] font-bold sm:mt-3 sm:text-[14px]">{name}</span>
        <span className="mt-0.5 block truncate px-0.5 pb-0.5 text-xs text-[var(--fg-dim)]">{subtitle}</span>
      </Link>
    </div>
  );
}
