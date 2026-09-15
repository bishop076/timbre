import { SearchResults } from "../search-results";

export const metadata = { title: "Search — Timbre" };

export default function SearchPage() {
  // The page's <h1> is the query itself, rendered by SearchResults — a heading that says
  // "Search results" over a page of search results tells a reader nothing the URL did not.
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      <SearchResults />
    </div>
  );
}
