"use client";

import Link from "next/link";

import { Artwork } from "./artwork";
import { PlayIcon } from "./icons";

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
