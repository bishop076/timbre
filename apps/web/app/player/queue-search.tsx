"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { SearchField } from "../search-field";
import type { Song, SongsResponse } from "../types";
import { AddToQueue } from "./add-to-queue";
import { QueueRow } from "./now-playing";
import { usePlayerControls } from "./player-context";

interface SearchState {
  results: Song[] | null;
  loading: boolean;
  failed: boolean;
}

const IDLE: SearchState = { results: null, loading: false, failed: false };

export function QueueSearch({ children }: { children: ReactNode }) {
  const { enqueue } = usePlayerControls();

  const [query, setQuery] = useState("");
  const [{ results, loading, failed }, setSearch] = useState<SearchState>(IDLE);

  const controller = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => {
      controller.current?.abort();
      if (!trimmed) {
        setSearch(IDLE);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setSearch((was) => ({ ...was, loading: true, failed: false }));

      const settle = (songs: Song[] | null) => {
        if (!next.signal.aborted) setSearch({ results: songs, loading: false, failed: !songs });
      };
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=12`, { signal: next.signal })
        .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
        .then((data) => settle(data?.songs ?? null), () => settle(null));
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
        <SearchField
          value={query}
          onChange={setQuery}
          onClear={clear}
          placeholder="Search to add to queue"
          label="Search for songs to add to the queue"
          clearLabel="Clear the search"
          busy={loading}
          field={field}
        />
      </div>

      {trimmed ? (
        <div className="scroller-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {failed ? (
            <p className="px-2 py-4 text-xs leading-relaxed text-[var(--fg-faint)]">
              That search didn&apos;t come back. The connection dropped, or the services are
              busy — the queue is untouched either way.
            </p>
          ) : results?.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-relaxed text-[var(--fg-faint)]">
              Nothing found for “{trimmed}”.
            </p>
          ) : (
            results && (
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
            )
          )}
        </div>
      ) : (
        children
      )}
    </>
  );
}
