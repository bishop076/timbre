"use client";

import { CheckIcon, QueueAddIcon } from "../icons";
import type { Song } from "../types";
import { usePlayer } from "./player-context";

/**
 * Queue one song, from any list that shows songs.
 *
 * Sits beside `AddToPlaylist` on the same rows and is deliberately the smaller
 * commitment of the two: a playlist is kept, a queue is what happens next. Both
 * are one click with no dialog, which is why neither needs a menu.
 *
 * **Already-queued songs keep the control and show a tick** rather than hiding
 * it. The queue is deduplicated by song id, so clicking a second time does
 * nothing — and a button that silently no-ops is indistinguishable from one
 * that is broken. Saying "it is already in there" costs a state and removes the
 * only confusing outcome.
 */
export function AddToQueue({ song, className }: { song: Song; className?: string }) {
  const { enqueue, queue } = usePlayer();
  const queued = queue.some((entry) => entry.id === song.id);

  return (
    <button
      type="button"
      onClick={() => enqueue([song])}
      disabled={queued}
      aria-label={queued ? `${song.title} is already queued` : `Add ${song.title} to the queue`}
      title={queued ? "In the queue" : "Add to queue"}
      className={`press flex size-8 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--fg-dim)] ${
        className ?? ""
      }`}
    >
      {queued ? <CheckIcon className="size-[18px]" /> : <QueueAddIcon className="size-[18px]" />}
    </button>
  );
}
