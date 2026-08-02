"use client";

import { ArtistLink } from "../artist-link";
import { useEffect, useState } from "react";

import { Artwork } from "../artwork";
import { PlayIcon } from "../icons";
import { AddToPlaylist } from "../playlists/add-to-playlist";
import type { Song, SongsResponse } from "../types";
import { usePlayer } from "./player-context";

/**
 * What else sounds like this.
 *
 * Distinct from Up Next on purpose, the way YouTube Music separates them: the
 * queue is what *will* play, this is what *could*. Nothing here is queued until
 * it is picked, so it can be browsed without disturbing the song.
 *
 * The list comes from `/api/radio`, which fuses ranked suggestions from every
 * source that will answer rather than passing one service's watch queue
 * through — see docs/RECOMMENDATIONS.md.
 */
export function RelatedPanel() {
  const { current, play, queue } = usePlayer();
  // Stored with the seed it came from, so "loading" is derived rather than a
  // second piece of state set on the way into the effect.
  const [found, setFound] = useState<{ seed: string; songs: Song[] } | null>(null);

  // Keyed by the seed's own id so a re-render does not refetch, and switching
  // tracks does.
  const seedId = current?.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
  const seedArtist = current?.artists[0] ?? null;

  const seed = `${seedId ?? ""}::${seedArtist ?? ""}`;

  useEffect(() => {
    if (!seedId && !seedArtist) return;

    const aborter = new AbortController();

    const params = new URLSearchParams();
    if (seedId) params.set("id", seedId);
    if (seedArtist) params.set("artist", seedArtist);

    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => setFound({ seed, songs: data?.songs ?? [] }))
      .catch((cause: unknown) => {
        // Settle even on failure, or `loading` stays true for the rest of the
        // song and the panel spins where it should say "nothing similar".
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setFound({ seed, songs: [] });
      });

    return () => aborter.abort();
  }, [seed, seedId, seedArtist]);

  const songs = found?.seed === seed ? found.songs : null;
  const loading = Boolean(current) && songs === null;

  if (!current) {
    return <Empty>Play something to see what goes with it.</Empty>;
  }

  if (loading && songs === null) {
    return <Empty>Finding songs like this…</Empty>;
  }

  if (!songs || songs.length === 0) {
    return <Empty>Nothing similar found for this track.</Empty>;
  }

  return (
    <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
      <ul className="flex flex-col gap-0.5">
        {songs.map((song) => (
          <li
            key={song.id}
            className="group flex items-center gap-2.5 rounded-[var(--r-md)] p-1.5 hover:bg-[var(--surface-2)]"
          >
            <button
              type="button"
              // Plays it now and queues the rest of the suggestions behind it,
              // so picking one turns the panel into a station rather than
              // stranding a single song at the end of the queue.
              onClick={() => play(song, [...songs.filter((item) => item.id !== song.id), ...queue])}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              aria-label={`Play ${song.title}`}
            >
              <span className="relative shrink-0">
                <Artwork
                  src={song.artworkUrl}
                  className="slab-sm size-10 rounded-[var(--r-sm)]"
                  iconClassName="size-4"
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-[var(--r-sm)] bg-black/55 opacity-0 transition group-hover:opacity-100">
                  <PlayIcon className="size-4 text-white" />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{song.title}</span>
                <span className="block truncate text-[11px] text-[var(--fg-dim)]">
                  <ArtistLink artists={song?.artists ?? []} />
                </span>
              </span>
            </button>

            <AddToPlaylist
              song={song}
              className="shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <p className="text-center text-sm leading-relaxed text-[var(--fg-faint)]">{children}</p>
    </div>
  );
}
