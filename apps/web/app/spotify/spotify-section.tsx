"use client";

import { useEffect, useState } from "react";

import { EYEBROW } from "../page-chrome";
import type { Song } from "../types";
import { searchSpotify, searchSpotifyCatalogue, type SpotifySearchResult } from "./search.ts";
import { useSpotifyTokens } from "./token-store.ts";

function failure(cause: unknown): SpotifySearchResult {
  return {
    kind: "error",
    message: cause instanceof Error ? cause.message : "Spotify did not answer.",
  };
}

export function SpotifySection({ query, render }: { query: string; render: (songs: Song[]) => React.ReactNode }) {
  const connected = Boolean(useSpotifyTokens());
  const [found, setFound] = useState<{ key: string; result: SpotifySearchResult } | null>(null);
  const trimmed = query.trim();
  const searchable = Boolean(trimmed) && !/^https?:\/\//i.test(trimmed);

  useEffect(() => {
    if (!searchable) return;

    const aborter = new AbortController();
    const timer = setTimeout(() => {
      searchSpotifyCatalogue(trimmed, aborter.signal)
        .then((songs): SpotifySearchResult => ({ kind: "ok", songs, from: "catalogue" }))
        .catch((cause: unknown) => {
          if (aborter.signal.aborted) throw cause;
          return connected ? searchSpotify(trimmed, aborter.signal) : failure(cause);
        })
        .then((result) => setFound({ key: trimmed, result }))
        .catch((cause: unknown) => {
          if (!aborter.signal.aborted) setFound({ key: trimmed, result: failure(cause) });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      aborter.abort();
    };
  }, [connected, searchable, trimmed]);

  const result = found?.key === trimmed ? found.result : null;

  if (!searchable || !result || result.kind === "off") return null;

  return (
    <section className="mt-8">
      <h2 className={`px-1 pb-2 ${EYEBROW}`}>On Spotify</h2>

      {result.kind === "error" ? (
        <p className="px-1 py-3 text-sm text-amber-500">{result.message}</p>
      ) : result.songs.length === 0 ? (
        <p className="px-1 py-3 text-sm text-[var(--fg-dim)]">Nothing on Spotify for this.</p>
      ) : (
        render(result.songs)
      )}

      <p className="px-1 pt-2 text-[11px] text-[var(--fg-faint)]">
        {result.kind === "ok" && result.from === "account"
          ? "From your own Spotify account."
          : "From Spotify's public catalogue — no account needed."}{" "}
        These play in Spotify&rsquo;s player and do not join the queue.
      </p>
    </section>
  );
}
