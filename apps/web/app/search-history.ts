"use client";

import { createJsonStore, useLocalStore } from "./local-store.ts";
import { MAX_QUERY, askedFor } from "./search-url.ts";

/**
 * What this browser has searched, and which of the canned suggestions it has thrown away.
 *
 * Both are the reader's own and stay here: two `localStorage` keys, no account, no server (the
 * README's non-goals are the rule this obeys, not a limitation it works around). Everything a
 * caller gets back has been through `askedFor` — the same clean the address bar and `/api/search`
 * already apply — so a chip can never render text the search box itself would refuse.
 */

const SEARCH_KEY = "timbre:searches";
const HIDDEN_KEY = "timbre:suggestions-hidden";

/**
 * Twenty searches and twenty-four hidden suggestions, both enforced on the way *in* as well as
 * on the way out.
 *
 * The strip shows at most three of the searches, so the rest is only depth — enough that
 * dismissing a few does not empty it, and small enough that the whole record is around half a
 * kilobyte. An unbounded log under one key is how `timbre:plays` learned that the quota is a
 * shared budget: once it is gone every later write fails, and the failure is silent.
 */
const SEARCH_LIMIT = 20;
const HIDDEN_LIMIT = 24;

const EMPTY: string[] = [];

/**
 * A list of queries out of storage, which is untrusted input like any other boundary.
 *
 * `localStorage` is hand-editable and survives every build, so this has to be total for a value
 * of any shape: not an array, an array of numbers, `null`, a ten-megabyte string, a key called
 * `__proto__`. The slice happens *before* `askedFor` deliberately — `askedFor` caps at
 * `MAX_QUERY`, but it NFKC-normalises and regex-scans the whole string first, so a planted
 * megabyte would be walked in full before its tail was thrown away. `Set` rather than a plain
 * object for the de-duplication, for the reason `song-shape.ts` uses `Object.hasOwn`: a stored
 * `"__proto__"` is a perfectly ordinary member of a `Set` and a booby trap in a `Record`.
 */
function queryList(stored: unknown, limit: number): string[] {
  if (!Array.isArray(stored)) return EMPTY;

  const list: string[] = [];
  const seen = new Set<string>();
  for (const value of stored) {
    if (list.length >= limit) break;
    if (typeof value !== "string") continue;
    const text = askedFor(value.slice(0, MAX_QUERY * 4));
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(text);
  }
  return list.length > 0 ? list : EMPTY;
}

export function parseSearches(stored: unknown): string[] {
  return queryList(stored, SEARCH_LIMIT);
}

export function parseHidden(stored: unknown): string[] {
  return queryList(stored, HIDDEN_LIMIT);
}

const searchStore = createJsonStore(SEARCH_KEY, EMPTY, parseSearches);
const hiddenStore = createJsonStore(HIDDEN_KEY, EMPTY, parseHidden);

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * What the list becomes once `query` has been searched.
 *
 * Typing *is* searching here — `search-results.tsx` runs one 300ms after every keystroke — so
 * "nil", "nils" and "nils frahm" are three searches this browser genuinely made and one thing
 * the reader was looking for. A new entry therefore drops any older one it extends, which leaves
 * the query they stopped at rather than the ladder they climbed to reach it. Without that rule a
 * history of twenty is a history of one search spelled out a letter at a time.
 */
export function withSearch(current: readonly string[], query: string): string[] {
  const text = askedFor(query);
  if (!text) return [...current];

  const key = text.toLowerCase();
  const kept = current.filter((entry) => {
    const other = entry.toLowerCase();
    return other !== key && !key.startsWith(other);
  });
  return [text, ...kept].slice(0, SEARCH_LIMIT);
}

/**
 * Records a search, if it is one worth recording.
 *
 * A failed write is left failed on purpose. The store publishes the new list to this tab either
 * way, and `writeItem` does not remove on failure, so what is already in storage survives intact
 * — which is the rule: a save that cannot happen changes nothing at all. Retrying with a
 * shorter list would be the one way to actually lose entries, and a quota with no room for
 * twenty short strings has a much larger problem than this key.
 */
export function rememberSearch(query: string): void {
  const current = searchStore.getSnapshot();
  const next = withSearch(current, query);
  if (sameList(next, current)) return;
  searchStore.save(next);
}

/** Drops one search from the record. It comes back if the reader searches it again — this is a
 *  forget, not a block; blocking is what `hideSuggestion` is for. */
export function forgetSearch(query: string): void {
  const current = searchStore.getSnapshot();
  const key = query.toLowerCase();
  const next = current.filter((entry) => entry.toLowerCase() !== key);
  if (sameList(next, current)) return;
  searchStore.save(next);
}

/** Puts one of the canned suggestions away for good, or until `showSuggestionsAgain`. */
export function hideSuggestion(suggestion: string): void {
  const text = askedFor(suggestion);
  if (!text) return;
  const current = hiddenStore.getSnapshot();
  if (current.some((entry) => entry.toLowerCase() === text.toLowerCase())) return;
  hiddenStore.save([text, ...current].slice(0, HIDDEN_LIMIT));
}

/**
 * The way back.
 *
 * Dismissal is persistent, and there are only six canned suggestions — a reader who puts them
 * all away has otherwise removed the feature from their browser with nothing anywhere offering
 * it back. The chip that calls this appears exactly when that has happened.
 */
export function showSuggestionsAgain(): void {
  if (hiddenStore.getSnapshot().length > 0) hiddenStore.save(EMPTY);
}

export function useSearches(): string[] {
  return useLocalStore(searchStore);
}

export function useHiddenSuggestions(): string[] {
  return useLocalStore(hiddenStore);
}
