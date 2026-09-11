"use client";

import { useEffect, useMemo, useState } from "react";

import { AddToPlaylist } from "../playlists/add-to-playlist";
import type { Song, SongsResponse } from "../types";
import { QueueRow } from "./now-playing";
import { Empty } from "./panel-tabs";
import { usePlayerControls } from "./player-context";
import { sameRecording } from "./song-match";

const RADIO_DEPTH = 50;

const SHOWN = 25;

export function RelatedPanel() {
  const { current, play, queue, radio } = usePlayerControls();
  const [found, setFound] = useState<{ seed: string; songs: Song[] } | null>(null);

  const seedId = current?.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
  const seedArtist = current?.artists[0] ?? null;
  const seedTitle = current?.title ?? null;

  const seed = `${seedId ?? ""}::${seedArtist ?? ""}::${seedTitle ?? ""}`;

  useEffect(() => {
    if (!seedId && !seedArtist && !seedTitle) return;

    const aborter = new AbortController();

    const params = new URLSearchParams({ limit: String(RADIO_DEPTH) });
    if (seedId) params.set("id", seedId);
    if (seedArtist) params.set("artist", seedArtist);
    if (seedTitle) params.set("title", seedTitle);

    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => setFound({ seed, songs: data?.songs ?? [] }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setFound({ seed, songs: [] });
      });

    return () => aborter.abort();
  }, [seed, seedId, seedArtist, seedTitle]);

  const fetched = found?.seed === seed ? found.songs : null;

  const songs = useMemo(() => {
    if (!fetched) return null;
    const coming = [...queue, ...radio];
    return fetched
      .filter((song) => !coming.some((other) => sameRecording(other, song)))
      .slice(0, SHOWN);
  }, [fetched, queue, radio]);

  const loading = Boolean(current) && songs === null;

  if (loading) {
    return <Empty>Finding songs like this…</Empty>;
  }

  if (!songs || songs.length === 0) {
    return fetched && fetched.length > 0 ? (
      <Empty>Everything similar to this is already in your queue.</Empty>
    ) : (
      <Empty>Nothing similar found for this track.</Empty>
    );
  }

  return (
    <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
      <ul className="flex flex-col gap-0.5">
        {songs.map((song) => (
          <li key={song.id}>
            <QueueRow
              song={song}
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
