"use client";

import Link from "next/link";

import { toArtistSlug } from "../artist-slug";
import { hideWhenBroken } from "../artwork";
import { cover as coverSrc } from "../artwork-url";
import { ChevronIcon } from "../icons";
import { useJson } from "./panel-tabs";

interface ArtistInfo {
  name: string;
  imageUrl: string | null;
  followers: number | null;
}

export function ArtistCard({ name }: { name: string | null }) {
  const artist = useJson<{ artist: ArtistInfo | null }>(
    name ? `/api/artist?name=${encodeURIComponent(name)}` : null,
  ).data?.artist;
  if (!artist) return null;

  return (
    <Link
      href={`/artist/${toArtistSlug(artist.name)}`}
      className="slab-sm press block overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)] transition hover:bg-[var(--surface-3)]"
    >
      <div className="relative h-28">
        {artist.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverSrc(artist.imageUrl, 320) ?? undefined}
            alt=""
            {...hideWhenBroken}
            className="size-full object-cover"
          />
        ) : (
          <div className="size-full bg-[var(--surface-3)]" />
        )}
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-6 text-[11px] font-bold uppercase tracking-wider text-white">
          About the artist
        </span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold">{artist.name}</p>
          {artist.followers !== null && (
            <p className="text-[11px] text-[var(--fg-dim)]">
              {artist.followers.toLocaleString()} followers on Deezer
            </p>
          )}
        </div>
        <span className="slab-sm shrink-0 rounded-[var(--r-full)] bg-[var(--surface-1)] px-2 py-1 text-[11px] font-bold text-[var(--fg-dim)]">
          <ChevronIcon className="size-3 -rotate-90" />
        </span>
      </div>
    </Link>
  );
}
