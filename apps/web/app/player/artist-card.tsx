"use client";

import { toArtistSlug } from "../artist-slug";
import { useEffect, useState } from "react";

import Link from "next/link";

import { ChevronIcon } from "../icons";
import { cover as coverSrc } from "../artwork-url";

interface ArtistInfo {
  name: string;
  imageUrl: string | null;
  followers: number | null;
  source: string;
  url: string | null;
}

export function ArtistCard({ name }: { name: string | null }) {
  const [loaded, setLoaded] = useState<{ name: string; info: ArtistInfo | null } | null>(null);

  useEffect(() => {
    if (!name) return;

    const aborter = new AbortController();
    fetch(`/api/artist?name=${encodeURIComponent(name)}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ artist: ArtistInfo | null }>) : null))
      .then((data) => setLoaded({ name, info: data?.artist ?? null }))
      .catch(() => {
      });

    return () => aborter.abort();
  }, [name]);

  const artist = loaded && loaded.name === name ? loaded.info : null;
  if (!artist) return null;

  return (
    <Link
      href={`/artist/${toArtistSlug(artist.name)}`}
      className="slab-sm press block overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)] transition hover:bg-[var(--surface-3)]"
    >
      <div className="relative h-28">
        {artist.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverSrc(artist.imageUrl, 320) ?? undefined} alt="" className="size-full object-cover" />
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
