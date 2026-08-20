"use client";

import { useEffect, useMemo, useState } from "react";

import { AddToPlaylist } from "../playlists/add-to-playlist";
import type { Song, SongsResponse } from "../types";
import { QueueRow } from "./now-playing";
import { Empty } from "./panel-tabs";
import { usePlayerControls } from "./player-context";
import { sameRecording } from "./song-match";

/**
 * How deep a radio to ask for. **Not the number shown** — the queue has already absorbed
 * this seed's first 25 (see the seeding effect in `player-context`), and this panel then
 * subtracts everything the queue holds, so asking for 25 here left nothing behind. Reported
 * as Related listing exactly what Up Next listed. 50 is the endpoint's ceiling, and each
 * source is asked for the full depth before fusion, so it genuinely widens the pool rather
 * than re-ranking the same songs.
 */
const RADIO_DEPTH = 50;

/** How many survivors to show. A panel, not a catalogue. */
const SHOWN = 25;

/**
 * What else sounds like this. Distinct from Up Next — the queue is what *will* play, this
 * is what *could*, and nothing is queued until picked. See docs/RECOMMENDATIONS.md.
 */
export function RelatedPanel() {
  const { current, play, queue, radio } = usePlayerControls();
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

    const params = new URLSearchParams({ limit: String(RADIO_DEPTH) });
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

  const fetched = found?.seed === seed ? found.songs : null;

  // Filtered here rather than in the fetch: the queue changes on every append and every
  // skip, and re-running the request for that would spend a fan-out to receive the same
  // songs. The seed is what the answer depends on; the queue only decides what to hide.
  const songs = useMemo(() => {
    if (!fetched) return null;
    // Everything the reader can already see coming — the whole queue, since the Up Next
    // pane also shows the parked recommendations it will step into at the end.
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
    // Two different outcomes, and telling them apart is the whole point of this panel:
    // a radio that found nothing is a dead end, a radio already queued is a full one.
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
