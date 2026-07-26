"use client";

import { NoteIcon, PlayIcon } from "../icons";
import { usePlayer } from "./player-context";

/**
 * What's playing next.
 *
 * A queue you cannot see is a queue you cannot trust — particularly here,
 * where a song may quietly resolve to a different source than the one it was
 * found on.
 */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  const { queue, index, play, current, state } = usePlayer();
  const upcoming = queue.slice(index + 1);

  return (
    <div className="max-h-72 overflow-y-auto border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="sticky top-0 flex items-baseline justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 sm:px-6">
        <h2 className="text-sm font-semibold">
          Queue
          <span className="ml-2 font-normal text-[var(--muted)]">
            {upcoming.length === 0 ? "nothing next" : `${upcoming.length} coming up`}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--muted)] transition hover:text-[var(--foreground)]"
        >
          Close
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--muted)] sm:px-6">
          Nothing queued yet. Playing a song queues whatever it was listed with.
        </p>
      ) : (
        <ul className="px-2 py-1.5 sm:px-4">
          {queue.map((song, position) => {
            const isCurrent = position === index;
            const isPast = position < index;

            return (
              <li key={`${song.id}-${position}`}>
                <button
                  type="button"
                  onClick={() => play(song, queue)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                    isCurrent ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-hover)]"
                  } ${isPast ? "opacity-45" : ""}`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--surface-hover)]">
                    {song.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                      <img src={song.artworkUrl} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <NoteIcon className="size-4 text-[var(--muted)]" />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${isCurrent ? "font-medium text-[var(--accent)]" : ""}`}
                    >
                      {song.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {song.artists.join(", ") || "Unknown artist"}
                    </span>
                  </span>

                  {isCurrent && current && (
                    <span className="shrink-0 text-[var(--accent)]">
                      {state === "playing" ? (
                        <span className="flex items-end gap-0.5" aria-label="Now playing">
                          <span className="h-3 w-0.5 animate-pulse bg-current" />
                          <span className="h-2 w-0.5 animate-pulse bg-current [animation-delay:150ms]" />
                          <span className="h-4 w-0.5 animate-pulse bg-current [animation-delay:300ms]" />
                        </span>
                      ) : (
                        <PlayIcon className="size-4" />
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
