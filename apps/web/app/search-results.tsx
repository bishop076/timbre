"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronIcon, CloseIcon, ExternalIcon, NoteIcon, PlayIcon, SearchIcon, SpinnerIcon } from "./icons";
import { useHistory } from "./player/history-store";
import { usePlayer } from "./player/player-context";
import { SongCard } from "./song-card";
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

  const hasQuery = query.trim().length > 0;
  const songs = results?.songs ?? [];

  return (
    <>
      {/* The bleed must match the page's own padding exactly — `page.tsx` uses
          px-5 / sm:px-7. When they disagree the sticky backdrop renders as a
          second, slightly-offset box around the input instead of a clean band
          across the panel. */}
      <div className="sticky top-0 z-20 -mx-5 -mt-5 mb-1 bg-[var(--surface-1)] px-5 pb-3 pt-4 sm:-mx-7 sm:px-7">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[var(--fg-dim)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search for a song, artist or mix — or paste a link…"
            autoFocus
            aria-label="Search for a song"
            className="slab w-full rounded-[var(--r-lg)] bg-[var(--surface-2)] py-2.5 pl-11 pr-12 text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-[var(--fg-faint)] focus:shadow-[var(--drop-lg)]"
          />
          {/*
            Three states in one slot, in priority order: searching, something to
            clear, or the shortcut hint. The clear button is ours rather than
            the browser's — `input[type="search"]` draws a blue ✕ in its own
            colours that cannot be themed, only removed, which globals.css does.
          */}
          {loading ? (
            <SpinnerIcon className="absolute right-3.5 top-1/2 size-[18px] -translate-y-1/2 animate-spin text-[var(--accent)]" />
          ) : hasQuery ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="press absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-[var(--r-sm)] text-[var(--fg-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
            >
              <CloseIcon className="size-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-md border border-[var(--line)] px-1.5 py-0.5 font-mono text-xs text-[var(--fg-dim)] sm:block">
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

        {!hasQuery && <Home charts={charts} />}


        {hasQuery && loading && songs.length === 0 && <Skeletons />}

        {hasQuery && !loading && songs.length === 0 && !error && (
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

/**
 * A horizontal row of tiles.
 *
 * Shelves rather than one long grid, because a grid of twenty covers reads as a
 * catalogue to be worked through, while a shelf reads as a selection to browse
 * — and it leaves room for more than one shelf on a screen without scrolling
 * past a wall of artwork first.
 *
 * Tiles are a fixed width and the row scrolls. Snapping is `proximity`, not
 * `mandatory`, so a deliberate flick still lands where it was aimed.
 */
function Shelf({
  title,
  caption,
  resetKey,
  children,
}: {
  title: string;
  caption?: string;
  /**
   * Changes when the row's *first* item changes, sending it back to the start.
   *
   * Disabling scroll anchoring stops the browser fighting a prepend, but a row
   * the user had already scrolled would still be left mid-way with the newest
   * item behind them. Only shelves whose head genuinely changes pass this.
   */
  resetKey?: string;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    if (resetKey === undefined) return;
    row.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [resetKey]);

  /*
   * Which arrows are live.
   *
   * Deliberately driven by the scroll event and a ResizeObserver rather than
   * measured directly in this effect: a synchronous read-and-set here would be
   * a second render pass to correct the first, and the observer fires on
   * observe anyway — so the initial state arrives without one.
   */
  useEffect(() => {
    const el = row.current;
    if (!el) return;

    const measure = () => {
      // A pixel of slack: fractional scroll positions mean `scrollLeft` rarely
      // lands exactly on 0 or on the maximum.
      const max = el.scrollWidth - el.clientWidth;
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft < max - 1);
    };

    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);

    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [children]);

  /** Scrolls by most of a screenful, leaving one tile as a visual anchor. */
  const nudge = (direction: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="mb-9">
      <div className="mb-3.5 flex items-center justify-between gap-4 px-1">
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {caption && (
            <p className="slab-sm hidden rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-dim)] @md:block">
              {caption}
            </p>
          )}
          {/*
            Arrows appear only when the row actually overflows, and each one
            disables at its end. A control that is always present but usually
            does nothing teaches people to ignore it.
          */}
          {(canLeft || canRight) && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => nudge(-1)}
                disabled={!canLeft}
                aria-label={`Scroll ${title} left`}
                className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] transition-opacity disabled:opacity-30"
              >
                <ChevronIcon className="size-4 rotate-90" />
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                disabled={!canRight}
                aria-label={`Scroll ${title} right`}
                className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] transition-opacity disabled:opacity-30"
              >
                <ChevronIcon className="size-4 -rotate-90" />
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Negative margin lets the row bleed to the panel edge, so the last tile
          is visibly cut rather than stopping short — the cue that says "this
          scrolls". The arrows above make it operable without a trackpad. */}
      {/*
        `scroll-pl-*` must match `px-*`. Without it the browser snaps the first
        tile to the raw scroll origin, which sits inside the padding — the row
        silently starts scrolled by exactly the padding width and the first
        cover is clipped against the edge on load.
      */}
      <div
        ref={row}
        className="shelf -mx-5 flex gap-4 overflow-x-auto px-5 pb-1 scroll-pl-5 sm:-mx-7 sm:px-7 sm:scroll-pl-7"
      >
        {children}
      </div>
    </section>
  );
}

/** One tile's worth of width, shared by the real card and its skeleton. */
const TILE = "w-[9.5rem] shrink-0 sm:w-[10.5rem]";

/**
 * Shelves built from what you have listened to.
 *
 * Both render nothing on a first visit, so a cold home page is exactly what it
 * was before this existed. History lives in localStorage and never leaves the
 * browser — see `history-store.ts`.
 */
function ForYou() {
  const history = useHistory();
  const [radio, setRadio] = useState<Song[]>([]);

  // The most recent play that can seed a radio. A song whose every copy
  // refused to embed has no upload id and cannot start one.
  const seed = history.find((entry) => entry.videoId);

  useEffect(() => {
    if (!seed?.videoId) return;

    const params = new URLSearchParams({ id: seed.videoId, title: seed.title, limit: "12" });
    const artist = seed.artists[0];
    if (artist) params.set("artist", artist);

    const aborter = new AbortController();
    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => setRadio(data?.songs ?? []))
      .catch(() => {
        // A missing shelf is not worth an error message.
      });

    return () => aborter.abort();
  }, [seed?.videoId, seed?.title, seed?.artists]);

  if (history.length === 0) return null;

  // Recently-played entries are stored flat rather than as whole songs, so
  // they are given the minimum a card needs. Playing one re-resolves it, the
  // same path a Deezer chart entry already takes.
  const recent: Song[] = history.slice(0, 12).map((entry) => ({
    id: entry.id,
    title: entry.title,
    artists: entry.artists,
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: entry.artworkUrl,
    sources: entry.videoId
      ? [
          {
            source: "ytmusic",
            sourceId: entry.videoId,
            url: `https://music.youtube.com/watch?v=${entry.videoId}`,
            playback: "queue" as const,
          },
        ]
      : [],
  }));

  return (
    <>
      <Shelf title="Recently played" caption="Only on this device" resetKey={recent[0]?.id}>
        {recent.map((song) => (
          <div key={song.id} className={TILE}>
            <SongCard song={song} queue={recent} />
          </div>
        ))}
      </Shelf>

      {radio.length > 0 && seed && (
        <Shelf title={`Because you played ${seed.title}`} caption="Blended across sources">
          {radio.map((song) => (
            <div key={song.id} className={TILE}>
              <SongCard song={song} queue={radio} />
            </div>
          ))}
        </Shelf>
      )}
    </>
  );
}

function Home({ charts }: { charts: SongsResponse | null }) {
  const songs = charts?.songs ?? [];

  return (
    <div className="rise pt-2">
      <ForYou />

      <Shelf title="Trending now" caption="Deezer · Apple Music">
        {charts === null
          ? Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={TILE} aria-hidden>
                <div className="aspect-square animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)]" />
                <div className="mt-2.5 h-3 w-3/4 animate-pulse rounded bg-[var(--surface-2)]" />
                <div className="mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
              </div>
            ))
          : songs.slice(0, 12).map((song) => (
              <div key={song.id} className={TILE}>
                <SongCard song={song} queue={songs} />
              </div>
            ))}
      </Shelf>

      {songs.length > 12 && (
        <Shelf title="More to hear" caption="Further down the charts">
          {songs.slice(12, 24).map((song) => (
            <div key={song.id} className={TILE}>
              <SongCard song={song} queue={songs} />
            </div>
          ))}
        </Shelf>
      )}

      <p className="mt-2 border-t border-[var(--line)] pt-5 text-xs leading-relaxed text-[var(--fg-faint)]">
        Charts come from Deezer and Apple Music, which Timbre can&rsquo;t play directly — picking one
        searches for a copy it can. Everything plays from the service it belongs to.
      </p>
    </div>
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
              src={song.artworkUrl}
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
            {song.artists.join(", ") || "Unknown artist"}
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
