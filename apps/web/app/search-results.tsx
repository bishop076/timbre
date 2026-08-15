"use client";

import { useEffect, useRef, useState } from "react";

import { ArtistLink } from "./artist-link";
import { cover as coverSrc } from "./artwork-url";
import { ExternalIcon, NoteIcon, PlayIcon } from "./icons";
import { AddToQueue } from "./player/add-to-queue";
import { usePlayer } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { useSearchQuery } from "./search-store";
import { sourceStyle } from "./sources";
import type { Song, SongsResponse } from "./types";

/** Whether what was typed is a link to resolve rather than words to search. */
function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Search results.
 *
 * **The field is not here.** It lives in the app shell, above the router, so it
 * survives the navigation from Home to this page — see `top-bar.tsx` for why
 * that has to be true for typing to work. This component reads what was typed
 * and answers it; it owns no input and draws no chrome.
 */
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

      // A pasted link is resolved rather than searched. This is the only way
      // SoundCloud tracks get in: its catalogue cannot be searched without a
      // paid account, while its player needs no credentials at all. Sharing a
      // link is also just how people pass songs around.
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
          // /api/resolve answers with a single song; normalise so the rest of
          // the component only ever handles one shape.
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
      // The request goes too, not just the pending debounce. Leaving `/search`
      // mid-flight left a search running to completion and then calling
      // `setResults` on a component nobody was looking at — a wasted round trip
      // against a metered upstream, on the one route people leave fastest.
      controller.current?.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const songs = results?.songs ?? [];

  /*
   * Every source Timbre asked refused.
   *
   * Guarded on `attempted > 0` because the count is optional — /api/resolve
   * answers with one song and no fan-out — and `0 === 0` would otherwise
   * declare a total outage on a response that never contacted anything.
   */
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

        {/*
          Partial and total outages are different events and must not share a
          message. With every source down, the old rendering stacked three
          "showing everything else" banners above "Nothing found for …" — which
          promised results that did not exist and then blamed the query for
          their absence. Someone reading that goes looking for a different
          spelling of a song that was there the whole time.
        */}
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

        {/*
          Nothing typed.

          **No suggestions here.** They belong to the field, which now shows them
          in a panel the moment it is focused — and since clearing the box leaves
          it focused, rendering them here as well put the same four chips on
          screen twice, one set directly above the other. A line of text is the
          whole empty state; the chips are one click away and already visible
          when anyone is actually about to type.
        */}
        {!hasQuery && (
          <p className="rise py-16 text-center text-sm text-[var(--fg-dim)]">
            Type above to search, or press <kbd className="font-mono">/</kbd> from anywhere.
          </p>
        )}

        {hasQuery && loading && songs.length === 0 && <Skeletons />}

        {/* `!allSourcesDown`: "nothing found" is a statement about the
            catalogue, and it is only true if something actually looked. */}
        {hasQuery && !loading && songs.length === 0 && !error && !allSourcesDown && (
          <p className="py-16 text-center text-[var(--fg-dim)]">
            Nothing found for “{query.trim()}”.
          </p>
        )}

        {hasQuery && songs.length > 0 && (
          <ul className="rise divide-y divide-[var(--line)]">
            {songs.map((song) => (
              <SongRow key={song.id} song={song} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function SongRow({ song }: { song: Song }) {
  const { play, current, state } = usePlayer();
  const isCurrent = current?.id === song.id;

  return (
    <li
      className={`group flex items-center gap-3 rounded-lg px-2 transition sm:gap-4 ${
        isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
      }`}
    >
      {/*
        The row itself plays. Opening the source is a deliberate secondary
        action on the badges, not what a click does by default.

        **It plays this song alone, and does not queue the other results.**
        Searching a song title returns that song over and over — the official
        upload, lyric videos, karaoke, covers, mashups, KIDZ BOP — because that
        is what the catalogue holds, and they are genuinely different uploads so
        the merger is right not to collapse them. Queueing all of them meant
        hearing the same song twenty times and never reaching the end of the
        queue, which is also where recommendations begin. Playing one song and
        continuing into the blend is both what you wanted and what Spotify and
        YouTube Music do with a search result.
      */}
      <button
        type="button"
        onClick={() => play(song)}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left focus:outline-none sm:gap-4"
        aria-label={`Play ${song.title}`}
      >
        <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-[var(--surface-1)]">
          {song.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
            <img
              src={coverSrc(song.artworkUrl, 112) ?? undefined}
              alt=""
              width={56}
              height={56}
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-[var(--fg-dim)]">
              <NoteIcon className="size-5" />
            </span>
          )}
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/55 transition ${
              isCurrent && state === "playing"
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <PlayIcon className="size-5 text-white" />
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[15px] font-medium ${isCurrent ? "text-[var(--accent)]" : ""}`}
          >
            {song.title}
          </span>
          <span className="block truncate text-sm text-[var(--fg-dim)]">
            <ArtistLink artists={song?.artists ?? []} />
            {song.album ? <span className="opacity-60"> · {song.album}</span> : null}
          </span>
        </span>
      </button>

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
    </li>
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
