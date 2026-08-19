import { SearchResults } from "../search-results";

export const metadata = { title: "Search — Timbre" };

/**
 * Results, and nothing else.
 *
 * The field is in the app shell, so this page does not draw one — it reads what
 * was typed and answers it. Arriving here with an empty box is not a dead end
 * either: the suggestions take that state, while browsing lives on Explore.
 */
export default function SearchPage() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      {/* The field lives in the shell, so this page draws no title — but a document with no
          `h1` announces nothing on arrival, and this is the page a reader lands on most. */}
      <h1 className="sr-only">Search results</h1>
      <SearchResults />
    </div>
  );
}
