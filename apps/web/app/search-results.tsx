"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { pastedCollectionOf } from "./pasted-collection";
import { SpotifySection } from "./spotify/spotify-section";

import { ArtistLink } from "./artist-link";
import { log } from "./logs.ts";
import { AddToQueue } from "./player/add-to-queue";
import { usePlayerControls } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import { useSearchQuery } from "./search-store";
import { SongRow } from "./song-row";
import { SourceBadges } from "./source-badges";
import { sourceStyle } from "./sources";
import type { Song, SongsResponse } from "./types";
import { formatDuration } from "./duration";

/**
 * A failure a reader can act on, rather than the one the platform threw.
 *
 * A dropped connection surfaces as `TypeError: Failed to fetch`, and that string was going
 * straight to the screen — it names no cause, suggests no action, and reads like the app
 * broke rather than the network. `navigator.onLine` is only trustworthy in the negative
 * (false definitely means no connection; true means an interface is up, not that anything is
 * reachable), which is exactly the direction needed here.
 */
function readableFailure(cause: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You're offline. Timbre searches other people's services, so it needs a connection — this will work again the moment you're back.";
  }
  // Every browser words this differently: "Failed to fetch", "NetworkError when attempting
  // to fetch resource", "Load failed". Matching the class rather than the wording.
  if (cause instanceof TypeError) {
    return "Couldn't reach Timbre. The connection dropped, or something between here and it is blocking the request.";
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

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

      // An album or playlist is a page of its own, not a song to resolve — the card below
      // links to it, and asking /api/resolve would only answer "not a track". Unless the link
      // names a song as well, as a YouTube `watch?v=…&list=…` does: that song still resolves.
      const pasted = pastedCollectionOf(trimmed);
      if (pasted && !pasted.withSong) {
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
            // A 404 from a proxy in front of the app is not JSON; the fallback sentence
            // is for that case too, not only for a body without `error`.
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
      // The in-flight request goes too, not just the debounce, or leaving `/search`
      // costs a round trip and a `setResults` nobody is looking at.
      controller.current?.abort();
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const pastedCollection = pastedCollectionOf(query);
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
          <div className="rise py-16 text-center text-sm text-[var(--fg-dim)]">
            <p>
              Type above to search, or press <kbd className="font-mono">/</kbd> from anywhere.
            </p>
            {/* SoundCloud and Spotify are the two sources that play but cannot be searched —
                their catalogue search is gated behind accounts this project will not buy. A
                pasted link works and always has, and nothing said so, which made the feature
                effectively invisible: the placeholder says "or a link" without saying whose. */}
            <p className="mx-auto mt-3 max-w-md text-[var(--fg-faint)]">
              Paste a <span className="text-[var(--fg-dim)]">SoundCloud</span> or{" "}
              <span className="text-[var(--fg-dim)]">Spotify</span> link and it plays here.
              Neither can be searched — only opened.
            </p>
            {/* Said for the same reason: a playlist link is the one thing search cannot find. */}
            <p className="mx-auto mt-2 max-w-md text-[var(--fg-faint)]">
              A <span className="text-[var(--fg-dim)]">YouTube</span> playlist link opens the whole
              list.
            </p>
          </div>
        )}

        {hasQuery && loading && songs.length === 0 && <Skeletons />}

        {/* `!allSourcesDown`: "nothing found" is only true if something actually looked. */}
        {pastedCollection && (
          <Link
            href={pastedCollection.href}
            className="slab press flex items-center justify-between gap-4 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-4 transition hover:bg-[var(--surface-3)]"
          >
            <span>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
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
          <ul className="rise divide-y divide-[var(--line)]">
            {songs.map((song) => (
              <ResultRow key={song.id} song={song} />
            ))}
          </ul>
        )}

        {/* Below the ranked list and never inside it — see `SpotifySection`. */}
        <SpotifySection
          query={query}
          render={(found) => (
            <ul className="divide-y divide-[var(--line)]">
              {found.map((song) => (
                <ResultRow key={song.id} song={song} />
              ))}
            </ul>
          )}
        />
      </div>
    </>
  );
}

function ResultRow({ song }: { song: Song }) {
  const { play, current, state } = usePlayerControls();

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
          {/* Each badge is now two controls: the label plays this song *from that source*,
              the arrow still opens it there. See `source-badges.tsx` for why only some of
              them can play, and why the ones that cannot say "30s" instead. */}
          <SourceBadges song={song} className="hidden @xl:flex" />

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
