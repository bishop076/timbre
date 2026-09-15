"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useSyncExternalStore } from "react";

import { moveBetweenItems } from "./a11y/arrow-nav";

import { useHistory } from "./player/history-store";
import { setSearchQuery } from "./search-store";
import { searchPath } from "./search-url";
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

export function SearchSuggestions({ id, onExit }: { id?: string; onExit?: () => void } = {}) {
  const history = useHistory();
  const router = useRouter();
  const seed = useSyncExternalStore(subscribeSeed, getSeed, () => 0);
  const row = useRef<HTMLDivElement>(null);

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

  // Arrows walk the chips; Escape, or an arrow off the front of the row, hands focus back to the
  // field it dropped out of. Tab still works and still leaves — that is the contract for a group
  // of buttons, and it is why these are not dressed up as a listbox: choosing one navigates to a
  // results page, which is not what an option in a combobox does.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && onExit) {
      event.preventDefault();
      onExit();
      return;
    }
    if (moveBetweenItems(event, row.current, "both")) return;
    if ((event.key === "ArrowUp" || event.key === "ArrowLeft") && onExit) {
      event.preventDefault();
      onExit();
    }
  }

  return (
    <div
      ref={row}
      id={id}
      role="group"
      aria-label="Suggested searches"
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1.5 sm:gap-2"
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => {
            setSearchQuery(suggestion);
            router.push(searchPath(suggestion));
          }}
          className="slab-sm press max-w-full truncate rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[12px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] sm:px-3 sm:py-1.5"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
