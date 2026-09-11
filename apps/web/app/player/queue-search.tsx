"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { CloseIcon, SearchIcon, SpinnerIcon } from "../icons";
import type { Song, SongsResponse } from "../types";
import { AddToQueue } from "./add-to-queue";
import { QueueRow } from "./now-playing";
import { usePlayerControls } from "./player-context";

export function QueueSearch({ children }: { children: ReactNode }) {
  const { enqueue } = usePlayerControls();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const controller = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => {
      controller.current?.abort();

      if (!trimmed) {
        setResults(null);
        setLoading(false);
        setFailed(false);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setLoading(true);
      setFailed(false);

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=12`, { signal: next.signal })
        .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
        .then((data) => {
          if (next.signal.aborted) return;
          if (!data) {
            setFailed(true);
            setResults(null);
          } else {
            setResults(data.songs);
          }
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (next.signal.aborted || (cause as Error)?.name === "AbortError") return;
          setFailed(true);
          setResults(null);
          setLoading(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmed]);

  useEffect(() => () => controller.current?.abort(), []);

  function clear() {
    setQuery("");
    field.current?.focus();
  }

  return (
    <>
      <div className="shrink-0 px-3 pb-1 pt-3">
        <div className="flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-1.5 focus-within:bg-[var(--surface-3)]">
          <SearchIcon className="size-4 shrink-0 text-[var(--fg-faint)]" />
          <input
            ref={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !query) return;
              event.stopPropagation();
              clear();
            }}
            type="search"
            placeholder="Search to add to queue"
            aria-label="Search for songs to add to the queue"
            className="min-w-0 flex-1 appearance-none bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-faint)] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {loading && <SpinnerIcon className="size-3.5 shrink-0 text-[var(--fg-faint)]" />}
          {query && !loading && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear the search"
              className="flex size-5 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--fg)]"
            >
              <CloseIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {trimmed ? (
        <div className="scroller-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {failed ? (
            <p className="px-2 py-4 text-xs leading-relaxed text-[var(--fg-faint)]">
              That search didn&apos;t come back. The connection dropped, or the services are
              busy — the queue is untouched either way.
            </p>
          ) : results === null ? (
            null
          ) : results.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-relaxed text-[var(--fg-faint)]">
              Nothing found for “{trimmed}”.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {results.map((song) => (
                <li key={song.id}>
                  <QueueRow
                    song={song}
                    onPlay={() => enqueue([song])}
                    label={`Add ${song.title} to the queue`}
                    actions={<AddToQueue song={song} className="shrink-0" />}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        children
      )}
    </>
  );
}
