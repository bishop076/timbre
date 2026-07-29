"use client";

import { QueueRow } from "./now-playing";
import { usePlayer } from "./player-context";

/**
 * What Timbre thinks you should hear next.
 *
 * These are **not** one service's radio passed through. Every source that can
 * answer contributes a ranked list, and a song several of them reach
 * independently outranks any single list's favourite — the one recommendation
 * signal Timbre can produce that no individual service can produce for itself.
 *
 * The same list is what the queue continues into when it runs out, so what is
 * shown here is a genuine preview rather than a second, differently-computed
 * opinion.
 *
 * Renders nothing when there is nothing to say, as the artist card does. An
 * empty panel headed "Similar songs" is worse than the space it occupies.
 */
export function SimilarSongs({ limit = 5 }: { limit?: number }) {
  const { radio, queue, play } = usePlayer();

  // Anything already queued is not a suggestion — it is a promise the player
  // has already made.
  const queued = new Set(queue.map((song) => song.id));
  const suggestions = radio.filter((song) => !queued.has(song.id)).slice(0, limit);

  if (suggestions.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
        Similar songs
      </h3>
      <ul className="flex flex-col gap-0.5">
        {suggestions.map((song) => (
          <li key={song.id}>
            {/* Playing one queues the rest behind it, so picking a suggestion
                continues the radio rather than ending it. */}
            <QueueRow song={song} onPlay={() => play(song, suggestions)} />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-[var(--fg-faint)]">
        Blended from every source that answers. Plays from YouTube Music, which is the
        only one Timbre can drive.
      </p>
    </section>
  );
}
