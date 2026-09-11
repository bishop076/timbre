"use client";

import { QueueRow } from "./now-playing";
import { usePlayerControls } from "./player-context";
import { sameRecording } from "./song-match";

export function SimilarSongs() {
  const { radio, queue, play } = usePlayerControls();

  const suggestions = radio
    .filter((song) => !queue.some((queued) => sameRecording(queued, song)))
    .slice(0, 5);

  if (suggestions.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
        Similar songs
      </h3>
      <ul className="flex flex-col gap-0.5">
        {suggestions.map((song) => (
          <li key={song.id}>
            <QueueRow song={song} onPlay={() => play(song, suggestions)} />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-[var(--fg-faint)]">
        Blended from every source that answers, and played by whichever of them can.
      </p>
    </section>
  );
}
