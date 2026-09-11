"use client";

import { CheckIcon, QueueAddIcon } from "../icons";
import type { Song } from "../types";
import { usePlayerControls } from "./player-context";
import { sameTrack } from "./song-match";

export function AddToQueue({ song, className }: { song: Song; className?: string }) {
  const { enqueue, queue } = usePlayerControls();
  const queued = queue.some((entry) => sameTrack(entry, song));

  return (
    <button
      type="button"
      onClick={() => enqueue([song])}
      disabled={queued}
      aria-label={queued ? `${song.title} is already queued` : `Add ${song.title} to the queue`}
      title={queued ? "In the queue" : "Add to queue"}
      className={`press flex size-8 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--fg-dim)] [@media(hover:none)]:opacity-100 ${
        className ?? ""
      }`}
    >
      {queued ? <CheckIcon className="size-[18px]" /> : <QueueAddIcon className="size-[18px]" />}
    </button>
  );
}
