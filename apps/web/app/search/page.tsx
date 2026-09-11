import { SearchResults } from "../search-results";

export const metadata = { title: "Search — Timbre" };

export default function SearchPage() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      <h1 className="sr-only">Search results</h1>
      <SearchResults />
    </div>
  );
}
