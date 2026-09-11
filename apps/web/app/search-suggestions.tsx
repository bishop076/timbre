"use client";

import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { useHistory } from "./player/history-store";
import { setSearchQuery } from "./search-store";
import { seededShuffle } from "@/lib/rotation";

const SUGGESTED_SEARCHES = [
  "Fred again..",
  "Wonderwall",
  "Aphex Twin",
  "boiler room set",
  "Sade",
  "lofi study mix",
];

let clientSeed = 0;

const subscribeSeed = () => () => {};

function getSeed(): number {
  if (clientSeed === 0) clientSeed = Math.floor(Math.random() * 2 ** 31) || 1;
  return clientSeed;
}

const includesName = (names: string[], name: string) =>
  names.some((other) => other.toLowerCase() === name.toLowerCase());

export function SearchSuggestions() {
  const history = useHistory();
  const router = useRouter();
  const seed = useSyncExternalStore(subscribeSeed, getSeed, () => 0);

  const suggestions = useMemo(() => {
    const played: string[] = [];
    for (const song of history) {
      const artist = song.artists?.[0];
      if (artist && !includesName(played, artist)) played.push(artist);
      if (played.length === 3) break;
    }

    const pool = SUGGESTED_SEARCHES.filter((candidate) => !includesName(played, candidate));
    return [...played, ...seededShuffle(pool, seed)].slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return (
    <div role="group" aria-label="Suggested searches" className="flex flex-wrap gap-1.5 sm:gap-2">
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
  );
}
