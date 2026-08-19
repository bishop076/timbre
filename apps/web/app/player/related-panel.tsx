"use client";

import { useEffect, useState } from "react";

import { AddToPlaylist } from "../playlists/add-to-playlist";
import type { Song, SongsResponse } from "../types";
import { QueueRow } from "./now-playing";
import { Empty } from "./panel-tabs";
import { usePlayerControls } from "./player-context";

/**
 * What else sounds like this. Distinct from Up Next — the queue is what *will* play, this
 * is what *could*, and nothing is queued until picked. See docs/RECOMMENDATIONS.md.
 */
export function RelatedPanel() {
  const { current, play, queue } = usePlayerControls();
  // Stored with its seed, so "loading" is derived rather than a second state.
  const [found, setFound] = useState<{ seed: string; songs: Song[] } | null>(null);

  // Keyed by the seed's own id, so a re-render does not refetch but a track change does.
  const seedId = current?.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
  const seedArtist = current?.artists[0] ?? null;
  // Carried too: it is the only handle Audius can use, since its user search matches
  // "The Weeknd" to "Louis The Child". Without it that source abstains from this panel.
  const seedTitle = current?.title ?? null;

  const seed = `${seedId ?? ""}::${seedArtist ?? ""}::${seedTitle ?? ""}`;

  useEffect(() => {
    if (!seedId && !seedArtist && !seedTitle) return;

    const aborter = new AbortController();

    const params = new URLSearchParams();
    if (seedId) params.set("id", seedId);
    if (seedArtist) params.set("artist", seedArtist);
    if (seedTitle) params.set("title", seedTitle);

    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => setFound({ seed, songs: data?.songs ?? [] }))
      .catch((cause: unknown) => {
        // Settle even on failure, or the panel spins for the rest of the song
        // instead of saying "nothing similar".
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setFound({ seed, songs: [] });
      });

    return () => aborter.abort();
  }, [seed, seedId, seedArtist, seedTitle]);

  const songs = found?.seed === seed ? found.songs : null;
  const loading = Boolean(current) && songs === null;

  if (loading) {
    return <Empty>Finding songs like this…</Empty>;
  }

  if (!songs || songs.length === 0) {
    return <Empty>Nothing similar found for this track.</Empty>;
  }

  return (
    <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
      <ul className="flex flex-col gap-0.5">
        {songs.map((song) => (
          <li key={song.id}>
            <QueueRow
              song={song}
              // Queues the rest behind it, so picking one becomes a station rather
              // than stranding a single song at the end of the queue.
              onPlay={() => play(song, [...songs.filter((item) => item.id !== song.id), ...queue])}
              playOverlay
              actions={
                <AddToPlaylist
                  song={song}
                  className="shrink-0 opacity-0 transition focus-within:opacity-100 group-hover/row:opacity-100"
                />
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
