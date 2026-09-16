// The search box is live: every keystroke updates the store and re-runs the search. The URL
// has to carry the query so a reload or a shared link still works, without turning one search
// into a dozen history entries — so navigating to /search pushes once, and every keystroke
// after that replaces. `search-store.ts` stays the thing the UI renders from; this is only the
// address bar catching up.

// Matches the cap `/api/search` enforces (`queryText(200)`), so a hand-edited URL cannot ask
// for more than the route would accept anyway.
export const MAX_QUERY = 200;

/**
 * What the box is actually asking for: the text with everything the route would strip already
 * stripped, and the length it would refuse already applied.
 *
 * This is `lib/query-text.ts`'s `queryText` on the other side of the wire, and it is here
 * because the two disagreeing is what the reader sees. `/api/search` cleans format characters
 * (`\p{Cf}` — the zero-width spaces, the soft hyphen, the bidi marks) and rejects what is left
 * when nothing is; it caps at 200 and answers 400 above it. The page sent whatever was in the
 * box, so a pasted soft hyphen — which `trim()` walks straight past, because a format character
 * is not whitespace — and a 500-character paste each came back as **"Search failed (400)"**, a
 * technical failure reported for a query the app could perfectly well have answered or
 * recognised as empty. Cleaning here means an invisible query is the empty state and a long one
 * searches its first 200 characters, which is also what the address bar has always held.
 *
 * NFKC runs first for the reason it does on the server: it folds a decomposed accent and a
 * full-width Latin letter onto the form the provider indexes, and turns a non-breaking space
 * into one the whitespace pass can then collapse.
 */
export function askedFor(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY);
}

export function searchPath(query: string): string {
  const asked = askedFor(query);
  return asked ? `/search?q=${encodeURIComponent(asked)}` : "/search";
}

/**
 * The query a `/search` URL is asking for. No try/catch: `URLSearchParams` does not throw on
 * a half-written escape, it leaves the `%` literal, and a literal `%` is a fine thing to
 * search for.
 */
export function readSearchQuery(search: string): string {
  return askedFor(new URLSearchParams(search).get("q") ?? "");
}
