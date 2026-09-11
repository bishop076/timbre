"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { pastedCollectionOf } from "./pasted-collection";
import { SpotifySection } from "./spotify/spotify-section";

import { ArtistLink } from "./artist-link";
import { log } from "./logs.ts";
import { EYEBROW } from "./page-chrome";
import { usePlayerControls } from "./player/player-context";
import { RowSkeletons } from "./row-skeleton";
import { useSearchQuery } from "./search-store";
import { SongActions, SongRow } from "./song-row";
import { SourceBadges } from "./source-badges";
import { sourceStyle } from "./sources";
import type { Song, SongsResponse } from "./types";

function readableFailure(cause: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You're offline. Timbre searches other people's services, so it needs a connection — this will work again the moment you're back.";
  }
  if (cause instanceof TypeError) {
    return "Couldn't reach Timbre. The connection dropped, or something between here and it is blocking the request.";
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

const ALERT = "rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400";

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

      setError(null);
      const pasted = pastedCollectionOf(trimmed);
      if (!trimmed || (pasted && !pasted.withSong)) {
        setResults(null);
        setLoading(false);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setLoading(true);

      const link = /^https?:\/\//i.test(trimmed);
      const endpoint = link
        ? `/api/resolve?url=${encodeURIComponent(trimmed)}`
        : `/api/search?q=${encodeURIComponent(trimmed)}`;

      fetch(endpoint, { signal: next.signal })
        .then(async (response) => {
          if (response.status === 404 && link) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "That link isn't one Timbre can play.");
          }
          if (!response.ok) throw new Error(`Search failed (${response.status})`);
          const body = (await response.json()) as SongsResponse | { song: Song } | null;
          if (!body || typeof body !== "object") throw new Error("Search returned nothing readable.");
          return "song" in body ? { songs: [body.song], failures: [] } : body;
        })
        .then((data) => {
          setResults(data);
          setLoading(false);

          const answered = (data.attempted ?? 1) - data.failures.length;
          log(
            data.failures.length > 0 ? "warn" : "info",
            `“${trimmed}” — ${answered}/${data.attempted ?? 1} sources answered, ${data.songs.length} results`,
          );
          for (const failure of data.failures) {
            log("warn", `${failure.source} refused: ${failure.message}`);
          }
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(readableFailure(cause));
          setLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const pastedCollection = pastedCollectionOf(query);
  const songs = results?.songs ?? [];
  const attempted = results?.attempted ?? 0;
  const allSourcesDown = attempted > 0 && results?.failures.length === attempted;

  return (
    <div aria-live="polite">
      {error && <p className={ALERT}>{error}</p>}

      {allSourcesDown ? (
        <div role="alert" className={ALERT}>
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

      {!hasQuery && (
        <div className="rise py-16 text-center text-sm text-[var(--fg-dim)]">
          <p>
            Type above to search, or press <kbd className="font-mono">/</kbd> from anywhere.
          </p>
          <p className="mx-auto mt-3 max-w-md text-[var(--fg-faint)]">
            Paste a <span className="text-[var(--fg-dim)]">SoundCloud</span> or{" "}
            <span className="text-[var(--fg-dim)]">Spotify</span> link and it plays here.
            Neither can be searched — only opened.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[var(--fg-faint)]">
            A <span className="text-[var(--fg-dim)]">YouTube</span> playlist link opens the whole
            list.
          </p>
        </div>
      )}

      {hasQuery && loading && songs.length === 0 && <RowSkeletons />}

      {pastedCollection && (
        <Link
          href={pastedCollection.href}
          className="slab press flex items-center justify-between gap-4 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-4 transition hover:bg-[var(--surface-3)]"
        >
          <span>
            <span className={`block ${EYEBROW}`}>
              {pastedCollection.service} {pastedCollection.noun}
            </span>
            <span className="mt-0.5 block text-sm font-semibold">
              Open this {pastedCollection.noun} in Timbre
            </span>
          </span>
          <span aria-hidden className="text-lg text-[var(--fg-dim)]">→</span>
        </Link>
      )}

      {hasQuery && !pastedCollection && !loading && songs.length === 0 && !error && !allSourcesDown && (
        <p className="py-16 text-center text-[var(--fg-dim)]">
          Nothing found for “{query.trim()}”.
        </p>
      )}

      {hasQuery && songs.length > 0 && (
        <ResultList songs={songs} className="rise divide-y divide-[var(--line)]" />
      )}

      <SpotifySection
        query={query}
        render={(found) => <ResultList songs={found} className="divide-y divide-[var(--line)]" />}
      />
    </div>
  );
}

function ResultList({ songs, className }: { songs: Song[]; className: string }) {
  const { play, current, state } = usePlayerControls();

  return (
    <ul className={className}>
      {songs.map((song) => (
        <SongRow
          key={song.id}
          song={song}
          onPlay={() => play(song)}
          isCurrent={current?.id === song.id}
          isPlaying={state === "playing"}
          size="lg"
          subtitle={
            <>
              <ArtistLink artists={song.artists} />
              {song.album ? <span className="opacity-60"> · {song.album}</span> : null}
            </>
          }
          trailing={
            <>
              <SourceBadges song={song} className="hidden @xl:flex" />
              <SongActions song={song} durationClassName="pr-1" />
            </>
          }
        />
      ))}
    </ul>
  );
}
