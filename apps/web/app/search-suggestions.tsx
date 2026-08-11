"use client";

import { useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";

import { useHistory } from "./player/history-store";
import { setSearchQuery } from "./search-store";
import { SUGGESTED_SEARCHES } from "./sources";

/**
 * What to type, when nothing is typed.
 *
 * **Half of it is yours.** Artists you have actually played come first, because
 * the most likely next search is something adjacent to the last thing you
 * listened to — and a suggestion list that never changes stops being read after
 * the second visit.
 *
 * The rest is a rotating sample of the built-in list, which is chosen to show
 * the catalogue off rather than to be popular: a DJ set, a lo-fi mix and an
 * artist whose name is punctuation are all things Timbre finds and a
 * subscription service would not.
 *
 * Sampled once per mount rather than on every render, so the row does not
 * reshuffle under the reader's thumb while they are looking at it.
 *
 * Picking one fills the field rather than running the search behind your back,
 * so the choice stays editable — half the value of a suggestion is seeing what
 * a query can look like before you commit to it.
 */

/**
 * A seed the client draws once, and the server never does.
 *
 * Two constraints collide here. `Math.random()` during render is impure —
 * React may render twice and get two orders, reshuffling the chips under a
 * thumb already moving toward one. But a module-level draw is worse: it is
 * evaluated once per *server process*, so every visitor would receive that
 * process's order in their HTML and then see the client's own order replace it
 * — a hydration mismatch on every load.
 *
 * `useSyncExternalStore` is the shape for exactly this: the server snapshot is
 * a fixed 0, the client's is drawn on first read, and React knows to expect the
 * two to differ.
 */
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
    // Most recent first, deduplicated: a favourite artist should appear once,
    // not once per play.
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
    // Fisher–Yates on a copy, from the drawn seed. `sort(() => random - 0.5)`
    // is the usual shortcut and is measurably biased — some orders never appear.
    const next = seeded(seed);
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    // Four, not six. This sits under the field now rather than filling the
    // foot of a page, and a row that wraps onto a second line reads as a menu
    // to work through instead of a nudge.
    return [...played, ...shuffled].slice(0, 4);
    // Keyed on the seed alone. Not on `history`: re-sampling every time a song
    // starts would rearrange the chips under a thumb already moving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return (
    // No visible heading. The chips sit directly under the search field now, so
    // a word telling you they are things to search for restates the box above
    // them. The label stays for anyone who cannot see that arrangement.
    // `role` is not decoration here: an `aria-label` on a bare <div> is ignored,
    // so without it the label would announce to nobody.
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
