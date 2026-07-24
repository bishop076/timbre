"use client";

import { useEffect, useRef, useState } from "react";

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

const SOURCE_LABELS: Record<string, string> = {
  ytmusic: "YouTube Music",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  deezer: "Deezer",
  apple: "Apple Music",
};

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SearchResults() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // Abort the in-flight request when the query changes, so a slow early
  // response can never overwrite a newer one.
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    // Everything happens inside the debounce callback, including clearing a
    // cleared box. Setting state synchronously in an effect body is what
    // react-hooks/set-state-in-effect forbids, and it would also fire on every
    // keystroke rather than once the user pauses.
    const timer = setTimeout(() => {
      controller.current?.abort();

      if (!trimmed) {
        setData(null);
        setStatus("idle");
        setError(null);
        return;
      }

      const next = new AbortController();
      controller.current = next;

      setStatus("loading");
      setError(null);

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: next.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Search failed (${response.status})`);
          return (await response.json()) as SearchResponse;
        })
        .then((result) => {
          setData(result);
          setStatus("idle");
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(cause instanceof Error ? cause.message : "Something went wrong.");
          setStatus("error");
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="w-full max-w-3xl">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search for a song…"
        autoFocus
        aria-label="Search for a song"
        className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-lg outline-none transition focus:border-[var(--accent)]"
      />

      <div className="mt-6" aria-live="polite">
        {status === "loading" && !data && (
          <p className="text-sm text-[var(--muted)]">Searching…</p>
        )}

        {status === "error" && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {data?.failures.map((failure) => (
          <p key={failure.source} className="mb-2 text-sm text-amber-500">
            {SOURCE_LABELS[failure.source] ?? failure.source} is unavailable — showing everything else.
          </p>
        ))}

        {data && data.songs.length === 0 && status === "idle" && (
          <p className="text-sm text-[var(--muted)]">Nothing found for “{query.trim()}”.</p>
        )}

        <ul className="divide-y divide-[var(--border)]">
          {data?.songs.map((song) => (
            <li key={song.id} className="flex items-center gap-4 py-3">
              {song.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                <img
                  src={song.artworkUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="size-12 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="size-12 shrink-0 rounded-md bg-[var(--surface)]" />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{song.title}</p>
                <p className="truncate text-sm text-[var(--muted)]">
                  {song.artists.join(", ") || "Unknown artist"}
                  {song.album ? ` · ${song.album}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {song.sources.map((source) => (
                  <a
                    key={source.source}
                    href={source.url ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`Open on ${SOURCE_LABELS[source.source] ?? source.source}`}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {SOURCE_LABELS[source.source] ?? source.source}
                  </a>
                ))}
                <span className="w-12 text-right font-mono text-sm text-[var(--muted)]">
                  {formatDuration(song.durationMs)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
