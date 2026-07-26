"use client";

import { useEffect, useRef, useState } from "react";

import { ExternalIcon, NoteIcon, PlayIcon, SearchIcon, SpinnerIcon } from "./icons";
import { SUGGESTED_SEARCHES, sourceStyle } from "./sources";

/** Mirrors the `Song` shape returned by /api/search. */
interface SourceTrack {
  source: string;
  sourceId: string;
  url: string | null;
  playback: "queue" | "manual" | "link";
}

interface Song {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  sources: SourceTrack[];
}

interface SearchResponse {
  songs: Song[];
  failures: { source: string; message: string }[];
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

export function SearchResults() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = query.trim();

    // Everything runs inside the debounce callback, including clearing a
    // cleared box: setting state synchronously in an effect body is both a
    // lint error and a per-keystroke render.
    const timer = setTimeout(() => {
      controller.current?.abort();

      if (!trimmed) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setLoading(true);
      setError(null);

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: next.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Search failed (${response.status})`);
          return (await response.json()) as SearchResponse;
        })
        .then((result) => {
          setData(result);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(cause instanceof Error ? cause.message : "Something went wrong.");
          setLoading(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // "/" focuses search, the convention every search-first app shares.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasQuery = query.trim().length > 0;
  const songs = data?.songs ?? [];

  return (
    <>
      <div className="sticky top-0 z-10 -mx-5 bg-[var(--background)]/80 px-5 pb-4 pt-1 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a song, artist or mix…"
            autoFocus
            aria-label="Search for a song"
            className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-4 pl-12 pr-14 text-base outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]"
          />
          {loading ? (
            <SpinnerIcon className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-[var(--accent)]" />
          ) : (
            <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-md border border-[var(--border)] px-1.5 py-0.5 font-mono text-xs text-[var(--muted)] sm:block">
              /
            </kbd>
          )}
        </div>
      </div>

      <div aria-live="polite" className="mt-2">
        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {data?.failures.map((failure) => (
          <p
            key={failure.source}
            className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
          >
            {sourceStyle(failure.source).label} is unavailable — showing everything else.
          </p>
        ))}

        {!hasQuery && <EmptyState onPick={setQuery} />}

        {hasQuery && loading && songs.length === 0 && <Skeletons />}

        {hasQuery && !loading && songs.length === 0 && !error && (
          <p className="py-16 text-center text-[var(--muted)]">
            Nothing found for “{query.trim()}”.
          </p>
        )}

        {songs.length > 0 && (
          <ul className="timbre-rise divide-y divide-[var(--border)]">
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
  const primary = song.sources[0];

  return (
    <li className="group flex items-center gap-4 rounded-xl px-3 py-3 transition hover:bg-[var(--surface-hover)]">
      <a
        href={primary?.url ?? undefined}
        target="_blank"
        rel="noreferrer noopener"
        className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)]"
        aria-label={`Play ${song.title}`}
      >
        {song.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img
            src={song.artworkUrl}
            alt=""
            width={56}
            height={56}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-[var(--muted)]">
            <NoteIcon className="size-6" />
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
          <PlayIcon className="size-6 text-white" />
        </span>
      </a>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{song.title}</p>
        <p className="truncate text-sm text-[var(--muted)]">
          {song.artists.join(", ") || "Unknown artist"}
          {song.album ? <span className="opacity-60"> · {song.album}</span> : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {song.sources.map((source) => {
          const style = sourceStyle(source.source);
          return (
            <a
              key={source.source}
              href={source.url ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              title={`Open on ${style.label}`}
              style={{ color: style.color, backgroundColor: style.tint, borderColor: style.color }}
              className="hidden items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium opacity-90 transition hover:opacity-100 sm:inline-flex"
            >
              {style.short}
              <ExternalIcon className="size-3" />
            </a>
          );
        })}
      </div>

      <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--muted)]">
        {formatDuration(song.durationMs)}
      </span>
    </li>
  );
}

function EmptyState({ onPick }: { onPick: (value: string) => void }) {
  return (
    <div className="timbre-rise py-14 text-center">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
        <NoteIcon className="size-7" />
      </div>
      <p className="text-lg font-medium">Search once, find it everywhere</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
        Timbre looks across the music you don&rsquo;t have to pay for, and shows you every
        service that has it.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {SUGGESTED_SEARCHES.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function Skeletons() {
  return (
    <ul className="divide-y divide-[var(--border)]" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-4 px-3 py-3">
          <div className="size-14 shrink-0 animate-pulse rounded-lg bg-[var(--surface-hover)]" />
          <div className="flex-1 space-y-2">
            <div
              className="h-4 animate-pulse rounded bg-[var(--surface-hover)]"
              style={{ width: `${55 - index * 4}%` }}
            />
            <div
              className="h-3 animate-pulse rounded bg-[var(--surface-hover)]"
              style={{ width: `${35 - index * 2}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
