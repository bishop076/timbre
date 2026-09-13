// The search box is live: every keystroke updates the store and re-runs the search. The URL
// has to carry the query so a reload or a shared link still works, without turning one search
// into a dozen history entries — so navigating to /search pushes once, and every keystroke
// after that replaces. `search-store.ts` stays the thing the UI renders from; this is only the
// address bar catching up.

// Matches the cap `/api/search` enforces (`queryText(200)`), so a hand-edited URL cannot ask
// for more than the route would accept anyway.
export const MAX_QUERY = 200;

export function searchPath(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `/search?q=${encodeURIComponent(trimmed.slice(0, MAX_QUERY))}` : "/search";
}

/**
 * The query a `/search` URL is asking for. No try/catch: `URLSearchParams` does not throw on
 * a half-written escape, it leaves the `%` literal, and a literal `%` is a fine thing to
 * search for.
 */
export function readSearchQuery(search: string): string {
  return new URLSearchParams(search).get("q")?.trim().slice(0, MAX_QUERY) ?? "";
}
