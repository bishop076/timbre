"use client";

import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { useHistory } from "./player/history-store";
import { setSearchQuery } from "./search-store";
import { SUGGESTED_SEARCHES } from "./sources";

// What to type, when nothing is typed. Artists you have played come first, then a rotating
// sample of the built-in list, drawn once per mount so the row does not reshuffle under a
// thumb already moving toward a chip.

// A seed the client draws once and the server never does. `Math.random()` during render is
// impure, and a module-level draw is worse — evaluated once per *server process*, so every
// visitor gets that process's order in their HTML and a hydration mismatch when the
// client's replaces it.
let clientSeed = 0;

function subscribeSeed(): () => void {
  // Never changes after the first read, so there is nothing to notify about.
  return () => {};
}

function getSeed(): number {
  if (clientSeed === 0) clientSeed = Math.floor(Math.random() * 2 ** 31) || 1;
  return clientSeed;
}

function getServerSeed(): number {
  return 0;
}

/** mulberry32 — small, fast, and good enough to order a handful of chips. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function SearchSuggestions({ className }: { className?: string }) {
  const history = useHistory();
  const router = useRouter();
  const seed = useSyncExternalStore(subscribeSeed, getSeed, getServerSeed);

  const suggestions = useMemo(() => {
    const played: string[] = [];
    for (const song of history) {
      const artist = song.artists?.[0];
      if (artist && !played.some((seen) => seen.toLowerCase() === artist.toLowerCase())) {
        played.push(artist);
      }
      if (played.length === 3) break;
    }

    const pool = SUGGESTED_SEARCHES.filter(
      (candidate) => !played.some((artist) => artist.toLowerCase() === candidate.toLowerCase()),
    );
    // Fisher–Yates: `sort(() => random - 0.5)` is measurably biased.
    const next = seeded(seed);
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    // Four, not six: a row that wraps reads as a menu rather than a nudge.
    return [...played, ...shuffled].slice(0, 4);
    // Keyed on the seed alone: re-sampling per song change would move the chips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return (
    // `role` is not decoration: an `aria-label` on a bare <div> is ignored, so
    // without it the label would announce to nobody.
    <div className={className} role="group" aria-label="Suggested searches">
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              setSearchQuery(suggestion);
              router.push("/search");
            }}
            className="slab-sm press max-w-full truncate rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] sm:px-3 sm:py-1.5"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
