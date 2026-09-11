"use client";

import { useEffect, useState } from "react";

import { searchSpotify, searchSpotifyCatalogue, type SpotifySearchResult } from "./search.ts";
import { useSpotifyTokens } from "./token-store.ts";
import type { Song } from "../types";

/**
 * Spotify's results, in their own attributed section beneath the blended ones.
 *
 * **Separate is the requirement, not a layout choice.** These are never merged into the ranked
 * list: each row hands off to Spotify's own embed, which the reader presses. That keeps a
 * connected account clear of Developer Terms IV.2, which forbid blending Spotify content with
 * another service's, and the no-account search is held to the same line.
 *
 * **Everyone gets it now.** It used to need a connected account, which a developer app caps at
 * five people. Timbre's server searches Spotify's public catalogue anonymously instead
 * (`/api/spotify/search`), and the reader's own account is the fallback for when that surface
 * breaks — it is Spotify's private one, and it will.
 */
export function SpotifySection({ query, render }: { query: string; render: (songs: Song[]) => React.ReactNode }) {
  const tokens = useSpotifyTokens();
  // Stored with the query it answers, the way `spotify-panel.tsx` stores its seed: clearing
  // state at the top of the effect is a synchronous setState and cascades a render, while
  // comparing keys at paint costs nothing and cannot show the previous query's results.
  const [found, setFound] = useState<{ key: string; result: SpotifySearchResult } | null>(null);

  const connected = Boolean(tokens);
  const trimmed = query.trim();
  // A pasted link is resolved by the ranked search above, not searched for as words.
  const searchable = Boolean(trimmed) && !/^https?:\/\//i.test(trimmed);

  useEffect(() => {
    if (!searchable) return;

    // Debounced like the blended search above it: a request already on the wire is not
    // recalled by aborting it, and ten keystrokes were ten searches.
    const aborter = new AbortController();
    const timer = setTimeout(() => {
      searchSpotifyCatalogue(trimmed, aborter.signal)
        .then((songs): SpotifySearchResult => ({ kind: "ok", songs, from: "catalogue" }))
        .catch(async (cause: unknown): Promise<SpotifySearchResult> => {
          if (aborter.signal.aborted) throw cause;
          // The catalogue refused. A connected account is a second, independent way in.
          if (connected) return searchSpotify(trimmed, aborter.signal);
          return {
            kind: "error",
            message: cause instanceof Error ? cause.message : "Spotify did not answer.",
          };
        })
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
  }, [connected, searchable, trimmed]);

  const result = found?.key === trimmed ? found.result : null;

  if (!searchable || !result || result.kind === "off") return null;

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
        {result.kind === "ok" && result.from === "account"
          ? "From your own Spotify account."
          : "From Spotify's public catalogue — no account needed."}{" "}
        These play in Spotify&rsquo;s player and do not join the queue.
      </p>
    </section>
  );
}
