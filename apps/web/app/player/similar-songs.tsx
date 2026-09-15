"use client";

import { moveBetweenItems } from "../a11y/arrow-nav";
import { EYEBROW } from "../page-chrome";
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
      <h3 className={`${EYEBROW} mb-1 px-1`}>Similar songs</h3>
      <ul className="flex flex-col gap-0.5">
        {suggestions.map((song) => (
          <li
            key={song.id}
            onKeyDown={(event) =>
              moveBetweenItems(event, event.currentTarget.parentElement, "vertical")
            }
          >
            <QueueRow song={song} onPlay={() => play(song, suggestions)} playOverlay />
          </li>
        ))}
      </ul>
      <p className="mt-2 px-1 text-[10px] leading-relaxed text-[var(--fg-faint)]">
        Blended from every source that answers, and played by whichever of them can.
      </p>
    </section>
  );
}
