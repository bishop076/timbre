"use client";

import { useEffect, useState } from "react";

import { EYEBROW } from "../page-chrome";
import type { Song } from "../types";
import { refusalLine } from "./failures.ts";
import { searchSpotify, searchSpotifyCatalogue, type SpotifySearchResult } from "./search.ts";
import { useSpotifyTokens } from "./token-store.ts";

function failure(cause: unknown): SpotifySearchResult {
  return {
    kind: "error",
    message: cause instanceof Error ? cause.message : refusalLine("unreachable"),
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
        <p role="alert" className="px-1 py-3 text-sm leading-relaxed text-[var(--warn)]">
          {result.message}
        </p>
      ) : result.songs.length === 0 ? (
        <p className="px-1 py-3 text-sm text-[var(--fg-dim)]">Nothing on Spotify for this.</p>
      ) : (
        render(result.songs)
      )}

      <p className="px-1 pt-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">
        {result.kind === "ok" && result.from === "account"
          ? "From your own Spotify account, filtered to what your market will actually play. "
          : "From Spotify's public catalogue — no account needed. "}
        {/* This used to say these "do not join the queue", which stopped being true when
            player-context learned to resolve a spotify source — every row here carries an
            "add to the queue" button that works. The copy dated from the commit that added
            Spotify search and nobody re-read it. */}
        These play through Spotify
        {connected
          ? ", in full if your account is Premium."
          : ". Without a connected account Spotify stops them at 30 seconds — that is their limit, not a fault here."}
      </p>
    </section>
  );
}
