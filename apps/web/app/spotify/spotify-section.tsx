"use client";

import { useEffect, useState } from "react";

import { searchSpotify, type SpotifySearchResult } from "./search.ts";
import { useSpotifyTokens } from "./token-store.ts";
import type { Song } from "../types";

/**
 * Spotify's results, in their own attributed section beneath the blended ones.
 *
 * **Separate is the requirement, not a layout choice.** Developer Terms IV.2 forbid blending
 * Spotify content with another service's, so these are never merged into the ranked list and
 * never become queue members: each row hands off to Spotify's own embed, which the reader
 * presses. It is also the only shape that could work — the token is in this browser and the
 * ranked search runs on the server.
 *
 * Renders nothing at all when no account is connected. An empty section under every search
 * would read as a source that is failing rather than one nobody asked for.
 */
export function SpotifySection({ query, render }: { query: string; render: (songs: Song[]) => React.ReactNode }) {
  const tokens = useSpotifyTokens();
  // Stored with the query it answers, the way `spotify-panel.tsx` stores its seed: clearing
  // state at the top of the effect is a synchronous setState and cascades a render, while
  // comparing keys at paint costs nothing and cannot show the previous query's results.
  const [found, setFound] = useState<{ key: string; result: SpotifySearchResult } | null>(null);

  const connected = Boolean(tokens);
  const trimmed = query.trim();

  useEffect(() => {
    if (!connected || !trimmed) return;

    // Debounced like the blended search above it, and for a stronger reason: this one runs
    // on the reader's own Spotify quota, and a request already on the wire is not recalled
    // by aborting it. Ten keystrokes were ten searches, which is how the 429 was earned.
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      searchSpotify(trimmed, aborter.signal)
        .then((next) => setFound({ key: trimmed, result: next }))
        .catch((cause: unknown) => {
          // Aborted by a newer query: that effect owns the answer. Anything else is a
          // failure this query has to report, or the previous query's section stays up.
          if (aborter.signal.aborted) return;
          setFound({
            key: trimmed,
            result: {
              kind: "error",
              message: cause instanceof Error ? cause.message : "Spotify did not answer.",
            },
          });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      aborter.abort();
    };
    // `connected` rather than `tokens`: the object is replaced on every refresh, and keying
    // on it would re-run this search an hour into a session for no reason.
  }, [connected, trimmed]);

  const result = found?.key === trimmed ? found.result : null;

  if (!connected || !trimmed || !result || result.kind === "off") return null;

  return (
    <section className="mt-8">
      <h2 className="px-1 pb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
        On Spotify
      </h2>

      {result.kind === "error" ? (
        <p className="px-1 py-3 text-sm text-amber-500">{result.message}</p>
      ) : result.songs.length === 0 ? (
        <p className="px-1 py-3 text-sm text-[var(--fg-dim)]">Nothing on Spotify for this.</p>
      ) : (
        render(result.songs)
      )}

      <p className="px-1 pt-2 text-[11px] text-[var(--fg-faint)]">
        From your own Spotify account. These play in Spotify&rsquo;s player and do not join
        the queue.
      </p>
    </section>
  );
}
