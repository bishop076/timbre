"use client";

import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { useHistory } from "./player/history-store";
import { setSearchQuery } from "./search-store";
import { SUGGESTED_SEARCHES } from "./sources";

let clientSeed = 0;

function subscribeSeed(): () => void {
  return () => {};
}

function getSeed(): number {
  if (clientSeed === 0) clientSeed = Math.floor(Math.random() * 2 ** 31) || 1;
  return clientSeed;
}

function getServerSeed(): number {
  return 0;
}

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
    const next = seeded(seed);
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    return [...played, ...shuffled].slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return (
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
