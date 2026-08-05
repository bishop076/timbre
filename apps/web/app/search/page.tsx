import { SearchResults } from "../search-results";

export const metadata = { title: "Search — Timbre" };

/**
 * Search, on its own route.
 *
 * `showShelves={false}` because the shelves belong to Home now. Left on, an
 * empty query here would render the whole home page underneath the field, and
 * the two tabs would be the same screen with the search box in a different
 * place.
 */
export default function SearchPage() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-5 pb-10 pt-5 sm:px-7">
      <SearchResults showShelves={false} />
    </div>
  );
}
