"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useSyncExternalStore } from "react";

import { moveBetweenItems } from "./a11y/arrow-nav";

import { CloseIcon } from "./icons";
import { useHistory } from "./player/history-store";
import {
  forgetSearch,
  hideSuggestion,
  showSuggestionsAgain,
  useHiddenSuggestions,
  useSearches,
} from "./search-history.ts";
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

/** Four chips, as before — the strip is a row of hints under a box, and a second row of them is
 *  the toolbar this is deliberately not. At most three go to what this browser has searched, so
 *  a busy history can never crowd out every suggestion. */
const SHOWN = 4;
const RECENT_SHOWN = 3;

/** How many artists a listener has actually played can stand in as suggestions. */
const PLAYED_SHOWN = 3;

let clientSeed = 0;

const subscribeSeed = () => () => {};

function getSeed(): number {
  if (clientSeed === 0) clientSeed = Math.floor(Math.random() * 2 ** 31) || 1;
  return clientSeed;
}

const includesName = (names: readonly string[], name: string) =>
  names.some((other) => other.toLowerCase() === name.toLowerCase());

/** A recent search is forgotten; a suggestion is put away. Same control, two different promises,
 *  and the accessible name is where the difference is told. */
type Chip = { text: string; recent: boolean };

export function SearchSuggestions({ id, onExit }: { id?: string; onExit?: () => void } = {}) {
  const history = useHistory();
  const searches = useSearches();
  const hidden = useHiddenSuggestions();
  const router = useRouter();
  const seed = useSyncExternalStore(subscribeSeed, getSeed, () => 0);
  const row = useRef<HTMLDivElement>(null);

  // Shuffled once per visit, filtered every render. The rotation used to be computed together
  // with the filtering behind an exhaustive-deps suppression, which meant a dismissal either
  // reshuffled the whole row or did not reach it at all. Separating them lets the row react to
  // what the reader just removed while still standing still.
  const rotated = useMemo(() => seededShuffle(SUGGESTED_SEARCHES, seed), [seed]);

  const chips = useMemo<Chip[]>(() => {
    // Most recent first, because that is the thing most likely to be half-typed again.
    const recent = searches.slice(0, RECENT_SHOWN);

    const played: string[] = [];
    for (const song of history) {
      const artist = song.artists?.[0];
      if (
        artist &&
        !includesName(recent, artist) &&
        !includesName(played, artist) &&
        !includesName(hidden, artist)
      ) {
        played.push(artist);
      }
      if (played.length === PLAYED_SHOWN) break;
    }

    const canned = rotated.filter(
      (candidate) =>
        !includesName(recent, candidate) &&
        !includesName(played, candidate) &&
        !includesName(hidden, candidate),
    );

    return [
      ...recent.map((text) => ({ text, recent: true })),
      ...[...played, ...canned].map((text) => ({ text, recent: false })),
    ].slice(0, SHOWN);
  }, [rotated, searches, hidden, history]);

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

  function search(query: string) {
    setSearchQuery(query);
    router.push(searchPath(query));
  }

  return (
    <div
      ref={row}
      id={id}
      role="group"
      aria-label="Suggested searches"
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-1 touch:gap-1.5"
    >
      {chips.map((chip) => (
        <span
          key={`${chip.recent ? "r" : "s"}:${chip.text}`}
          className="slab-sm group flex min-w-0 max-w-full items-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[11px] font-semibold leading-[14px] text-[var(--fg-dim)] touch:py-1 touch:text-[12px] touch:leading-[20px]"
        >
          <button
            type="button"
            onClick={() => search(chip.text)}
            title={chip.text}
            className="press min-w-0 truncate pl-2.5 pr-1 transition hover:text-[var(--fg)]"
          >
            {chip.text}
          </button>

          {/* Hidden at rest on a pointer and drawn at rest without one. A dismiss control that
              only exists under a hover is a control a phone cannot reach — eleven of those were
              found in this app and fixed; this is not the twelfth. `before:` grows what the
              press has to land on to 24 × 24 without moving the 10px cross that shows where it
              is, the same trick `source-badges.tsx` uses on the smallest glyph here. It grows
              right and barely left on purpose: to the right is the chip's own margin and the gap
              before the next one, and a symmetric inset would have put five pixels of "throw this
              away" on top of the end of the word you were trying to click. */}
          <button
            type="button"
            onClick={() => (chip.recent ? forgetSearch(chip.text) : hideSuggestion(chip.text))}
            aria-label={
              chip.recent ? `Forget the search for ${chip.text}` : `Hide the suggestion ${chip.text}`
            }
            className="press relative mr-1 flex size-3.5 shrink-0 items-center justify-center rounded-[var(--r-full)] opacity-0 transition before:absolute before:-inset-y-[5px] before:-left-px before:-right-[9px] before:content-[''] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:size-6 touch:before:hidden touch:opacity-100"
          >
            <CloseIcon className="size-2.5" />
          </button>
        </span>
      ))}

      {/* The way back out of a decision that otherwise has none. Dismissal is written to this
          browser and survives a reload, and there are only six suggestions — put them all away
          and the strip is empty for good, with nothing anywhere offering them back. This appears
          exactly then, and never while there is still something to show. */}
      {chips.length === 0 && (
        <button
          type="button"
          onClick={showSuggestionsAgain}
          className="slab-sm press rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 text-[11px] font-semibold leading-[14px] text-[var(--fg-dim)] transition hover:text-[var(--fg)] touch:py-1 touch:text-[12px] touch:leading-[20px]"
        >
          Show suggestions again
        </button>
      )}
    </div>
  );
}
