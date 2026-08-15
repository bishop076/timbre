"use client";

import { useEffect, useRef, useState } from "react";

import { ArtistLink } from "./artist-link";
import { ExternalIcon } from "./icons";
import { AddToQueue } from "./player/add-to-queue";
import { usePlayer } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { useSearchQuery } from "./search-store";
import { SongRow } from "./song-row";
import { sourceStyle } from "./sources";
import type { Song, SongsResponse } from "./types";
import { formatDuration } from "./duration";

/** Whether what was typed is a link to resolve rather than words to search. */
function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}


/** Search results. The field lives in the app shell, above the router, so it survives navigation — see `top-bar.tsx`. */
export function SearchResults() {
  const query = useSearchQuery();
  const [results, setResults] = useState<SongsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    const timer = setTimeout(() => {
      controller.current?.abort();

      if (!trimmed) {
        setResults(null);
        setLoading(false);
        setError(null);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setLoading(true);
      setError(null);

      // A pasted link is resolved, not searched — the only way SoundCloud tracks get in,
      // since its catalogue needs a paid account and its player needs none.
      const endpoint = isUrl(trimmed)
        ? `/api/resolve?url=${encodeURIComponent(trimmed)}`
        : `/api/search?q=${encodeURIComponent(trimmed)}`;

      fetch(endpoint, { signal: next.signal })
        .then(async (response) => {
          if (response.status === 404 && isUrl(trimmed)) {
            const body = (await response.json()) as { error?: string };
            throw new Error(body.error ?? "That link isn't one Timbre can play.");
          }
          if (!response.ok) throw new Error(`Search failed (${response.status})`);
          const body = (await response.json()) as SongsResponse | { song: Song };
          return "song" in body ? { songs: [body.song], failures: [] } : body;
        })
        .then((data) => {
          setResults(data);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(cause instanceof Error ? cause.message : "Something went wrong.");
          setLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      // The in-flight request goes too, not just the debounce, or leaving `/search`
      // costs a round trip and a `setResults` nobody is looking at.
      controller.current?.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const songs = results?.songs ?? [];

  // Guarded on `attempted > 0`: optional, and `0 === 0` declares a false total outage.
  const attempted = results?.attempted ?? 0;
  const allSourcesDown = attempted > 0 && results?.failures.length === attempted;

  return (
    <>
      <div aria-live="polite">
        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {/* Partial and total outages must not share a message: "showing everything else"
            above "Nothing found for …" blames the query for an outage. */}
        {allSourcesDown ? (
          <div
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          >
            <p className="font-semibold">Couldn&rsquo;t reach any music service.</p>
            <p className="mt-1 text-red-400/80">
              This is on our side, not yours — your search is fine. Try again in a moment.
            </p>
          </div>
        ) : (
          results?.failures.map((failure) => (
            <p
              key={failure.source}
              className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
            >
              {sourceStyle(failure.source).label} is unavailable — showing everything else.
            </p>
          ))
        )}

        {/* No suggestions here — the field shows them on focus, and clearing the box
            leaves it focused, so this would put the same chips on screen twice. */}
        {!hasQuery && (
          <p className="rise py-16 text-center text-sm text-[var(--fg-dim)]">
            Type above to search, or press <kbd className="font-mono">/</kbd> from anywhere.
          </p>
        )}

        {hasQuery && loading && songs.length === 0 && <Skeletons />}

        {/* `!allSourcesDown`: "nothing found" is only true if something actually looked. */}
        {hasQuery && !loading && songs.length === 0 && !error && !allSourcesDown && (
          <p className="py-16 text-center text-[var(--fg-dim)]">
            Nothing found for “{query.trim()}”.
          </p>
        )}

        {hasQuery && songs.length > 0 && (
          <ul className="rise divide-y divide-[var(--line)]">
            {songs.map((song) => (
              <ResultRow key={song.id} song={song} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ResultRow({ song }: { song: Song }) {
  const { play, current, state } = usePlayer();

  return (
    <SongRow
      song={song}
      // Plays this song alone and does *not* queue the other results: a title search
      // returns the same song many times over, so queueing them all never reaches the
      // end of the queue, which is where recommendations begin.
      onPlay={() => play(song)}
      isCurrent={current?.id === song.id}
      isPlaying={state === "playing"}
      size="lg"
      subtitle={
        <>
          <ArtistLink artists={song?.artists ?? []} />
          {song.album ? <span className="opacity-60"> · {song.album}</span> : null}
        </>
      }
      trailing={
        <>
          <div className="hidden shrink-0 items-center gap-1 @xl:flex">
            {song.sources.map((source) => {
              const style = sourceStyle(source.source);
              return (
                <a
                  key={source.source}
                  href={source.url ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`Open on ${style.label}`}
                  style={{ color: style.color, backgroundColor: style.tint }}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium opacity-0 transition group-hover:opacity-90 hover:!opacity-100"
                >
                  {style.short}
                  <ExternalIcon className="size-2.5" />
                </a>
              );
            })}
          </div>

          <span className="hidden w-12 shrink-0 pr-1 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
            {formatDuration(song.durationMs)}
          </span>

          <AddToQueue
            song={song}
            className="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
          />

          <AddToPlaylist
            song={song}
            className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
          />
        </>
      }
    />
  );
}

function Skeletons() {
  return (
    <ul className="divide-y divide-[var(--line)]" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-4 px-3 py-3">
          <div className="size-14 shrink-0 animate-pulse rounded-lg bg-[var(--surface-2)]" />
          <div className="flex-1 space-y-2">
            <div
              className="h-4 animate-pulse rounded bg-[var(--surface-2)]"
              style={{ width: `${55 - index * 4}%` }}
            />
            <div
              className="h-3 animate-pulse rounded bg-[var(--surface-2)]"
              style={{ width: `${35 - index * 2}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
