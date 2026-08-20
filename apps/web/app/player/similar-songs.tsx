"use client";

import { QueueRow } from "./now-playing";
import { usePlayerControls } from "./player-context";
import { sameRecording } from "./song-match";

/** What Timbre thinks you should hear next — the same fused list the queue continues into
 * when it runs out, so this is a preview rather than a second opinion. */
export function SimilarSongs({ limit = 5 }: { limit?: number }) {
  const { radio, queue, play } = usePlayerControls();

  // Anything already queued is a promise, not a suggestion. Matched on the recording rather
  // than the id alone, like the Related panel: the id agrees whenever both lists came from
  // one merge, and stops agreeing the moment a queue entry arrived from search instead.
  const suggestions = radio
    .filter((song) => !queue.some((queued) => sameRecording(queued, song)))
    .slice(0, limit);

  if (suggestions.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
        Similar songs
      </h3>
      <ul className="flex flex-col gap-0.5">
        {suggestions.map((song) => (
          <li key={song.id}>
            {/* Playing one queues the rest, continuing the radio rather than ending it. */}
            <QueueRow song={song} onPlay={() => play(song, suggestions)} />
          </li>
        ))}
      </ul>
      <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-[var(--fg-faint)]">
        {/* This used to end "Plays from YouTube Music, which is the only one Timbre can
            drive", which was true when only YouTube had a player here. It is now one of
            eight: SoundCloud and Mixcloud have widgets, Spotify's embed can be script-
            started, and Audius and the archive come out of Timbre's own audio element. */}
        Blended from every source that answers, and played by whichever of them can.
      </p>
    </section>
  );
}
