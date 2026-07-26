"use client";

import { useEffect, useRef, useState } from "react";

import { ExternalIcon, NoteIcon, PlayIcon, SearchIcon, SpinnerIcon } from "./icons";
import { SongCard } from "./song-card";
import { sourceStyle } from "./sources";
import type { Song, SongsResponse } from "./types";

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
  const [results, setResults] = useState<SongsResponse | null>(null);
  const [charts, setCharts] = useState<SongsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Charts load once and stay: they are the home page, so returning to it
  // after a search should be instant rather than refetching.
  useEffect(() => {
    const aborter = new AbortController();
    fetch("/api/charts", { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => data && setCharts(data))
      .catch(() => {
        // A missing chart is not worth an error message — the search box
        // still works, which is the point of the page.
      });
    return () => aborter.abort();
  }, []);

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

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: next.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Search failed (${response.status})`);
          return (await response.json()) as SongsResponse;
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

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape" && typing) inputRef.current?.blur();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const pick = (value: string) => {
    setQuery(value);
    inputRef.current?.focus();
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const hasQuery = query.trim().length > 0;
  const songs = results?.songs ?? [];

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

      <div aria-live="polite">
        {error && (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {results?.failures.map((failure) => (
          <p
            key={failure.source}
            className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
          >
            {sourceStyle(failure.source).label} is unavailable — showing everything else.
          </p>
        ))}

        {!hasQuery && <Home charts={charts} onPick={pick} />}

        {hasQuery && loading && songs.length === 0 && <Skeletons />}

        {hasQuery && !loading && songs.length === 0 && !error && (
          <p className="py-16 text-center text-[var(--muted)]">
            Nothing found for “{query.trim()}”.
          </p>
        )}

        {hasQuery && songs.length > 0 && (
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

function Home({
  charts,
  onPick,
}: {
  charts: SongsResponse | null;
  onPick: (query: string) => void;
}) {
  return (
    <div className="timbre-rise">
      <section className="mb-2 mt-4">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Trending now</h2>
          <p className="text-xs text-[var(--muted)]">Across Deezer and Apple Music</p>
        </div>

        {charts === null ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index}>
                <div className="aspect-square animate-pulse rounded-xl bg-[var(--surface-hover)]" />
                <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-[var(--surface-hover)]" />
                <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-[var(--surface-hover)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {charts.songs.slice(0, 16).map((song) => (
              <SongCard key={song.id} song={song} onPick={onPick} />
            ))}
          </div>
        )}
      </section>

      <p className="mt-10 border-t border-[var(--border)] pt-6 text-xs leading-relaxed text-[var(--muted)]">
        Charts come from Deezer and Apple Music, which Timbre can&rsquo;t play directly — picking one
        searches for a copy it can. Everything plays from the service it belongs to.
      </p>
    </div>
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
