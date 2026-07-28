"use client";

import { useEffect, useState } from "react";

import { ExternalIcon } from "../icons";

interface ArtistInfo {
  name: string;
  imageUrl: string | null;
  followers: number | null;
  source: string;
  url: string | null;
}

/**
 * About the artist.
 *
 * Spotify's panel has a card like this and it is most of what makes the column
 * feel like more than a queue. Ours carries a picture, a name and a follower
 * count — and **no biography**, because no keyless source publishes one and
 * inventing a paragraph about a real musician is not a design choice, it is a
 * fabrication.
 *
 * The card removes itself when there is nothing to say. An empty card labelled
 * "About the artist" is worse than the space it would occupy.
 */
export function ArtistCard({ name }: { name: string | null }) {
  /*
   * The fetched artist is stored *with the name it was fetched for*, and the
   * match is checked at render. Clearing it in an effect when the track changes
   * would be a second render pass to undo the first, and would flash the
   * previous artist underneath the new track for a frame.
   */
  const [loaded, setLoaded] = useState<{ name: string; info: ArtistInfo | null } | null>(null);

  useEffect(() => {
    if (!name) return;

    const aborter = new AbortController();
    fetch(`/api/artist?name=${encodeURIComponent(name)}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ artist: ArtistInfo | null }>) : null))
      .then((data) => setLoaded({ name, info: data?.artist ?? null }))
      .catch(() => {
        // A missing artist card is not worth an error message.
      });

    return () => aborter.abort();
  }, [name]);

  const artist = loaded && loaded.name === name ? loaded.info : null;
  if (!artist) return null;

  return (
    <section className="slab-sm overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)]">
      <div className="relative h-28">
        {artist.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img src={artist.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full bg-[var(--surface-3)]" />
        )}
        {/* The label sits on the picture, as Spotify's does — it reads as a
            caption on a photograph rather than as another list heading. */}
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
        {artist.url && (
          <a
            href={artist.url}
            target="_blank"
            rel="noreferrer noopener"
            className="slab-sm press shrink-0 rounded-[var(--r-full)] bg-[var(--surface-1)] px-2.5 py-1 text-[11px] font-bold"
          >
            <span className="flex items-center gap-1">
              Open
              <ExternalIcon className="size-2.5" />
            </span>
          </a>
        )}
      </div>
    </section>
  );
}
