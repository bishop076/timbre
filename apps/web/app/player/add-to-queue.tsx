"use client";

import { CheckIcon, QueueAddIcon } from "../icons";
import type { Song } from "../types";
import { usePlayerControls } from "./player-context";

/**
 * Queue one song, from any list that shows songs. An already-queued song keeps the
 * control and shows a tick: the queue dedupes by song id, so a second click does
 * nothing, and a silently no-op button is indistinguishable from a broken one.
 */
export function AddToQueue({ song, className }: { song: Song; className?: string }) {
  const { enqueue, queue } = usePlayerControls();
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
