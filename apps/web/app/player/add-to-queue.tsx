"use client";

import { CheckIcon, QueueAddIcon } from "../icons";
import type { Song } from "../types";
import { usePlayerControls } from "./player-context";
import { sameTrack } from "./song-match";

/**
 * Queue one song, from any list that shows songs. An already-queued song keeps the
 * control and shows a tick: the queue dedupes, so a second click does nothing, and a
 * silently no-op button is indistinguishable from a broken one.
 *
 * Matched by `sameTrack` rather than by id, so this agrees with what `enqueue` will
 * actually do — an id comparison showed a fresh button for a song already in the queue
 * under another id, and pressing it then did nothing at all.
 */
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
      /* `hover:none` keeps this visible where there is no cursor to reveal it with. Every
         caller hides it behind `opacity-0 group-hover:opacity-100`, which on a phone means
         permanently invisible — the queue button was unreachable by touch entirely. */
      className={`press flex size-8 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--fg-dim)] [@media(hover:none)]:opacity-100 ${
        className ?? ""
      }`}
    >
      {queued ? <CheckIcon className="size-[18px]" /> : <QueueAddIcon className="size-[18px]" />}
    </button>
  );
}
