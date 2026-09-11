"use client";

import { AddToPlaylist } from "../playlists/add-to-playlist";
import type { SongsResponse } from "../types";
import { QueueRow } from "./now-playing";
import { Empty, useJson } from "./panel-tabs";
import { usePlayerControls } from "./player-context";
import { sameRecording } from "./song-match";

const RADIO_DEPTH = 50;
const SHOWN = 25;

export function RelatedPanel() {
  const { current, play, queue, radio } = usePlayerControls();

  const seedId = current?.sources.find((source) => source.source === "ytmusic")?.sourceId;
  const seedArtist = current?.artists[0];
  const seedTitle = current?.title;
  const params = new URLSearchParams({ limit: String(RADIO_DEPTH) });
  if (seedId) params.set("id", seedId);
  if (seedArtist) params.set("artist", seedArtist);
  if (seedTitle) params.set("title", seedTitle);

  const { data, loading } = useJson<SongsResponse>(
    seedId || seedArtist || seedTitle ? `/api/radio?${params}` : null,
  );
  const fetched = loading ? null : (data?.songs ?? []);
  const coming = [...queue, ...radio];
  const songs = fetched
    ?.filter((song) => !coming.some((other) => sameRecording(other, song)))
    .slice(0, SHOWN);

  if (current && !songs) return <Empty>Finding songs like this…</Empty>;

  if (!songs?.length) {
    return (
      <Empty>
        {fetched?.length
          ? "Everything similar to this is already in your queue."
          : "Nothing similar found for this track."}
      </Empty>
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
