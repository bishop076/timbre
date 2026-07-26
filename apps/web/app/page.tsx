import { SearchResults } from "./search-results";

export default function Home() {
  return (
    // @container so children size themselves against this column rather than
    // the viewport. With a sidebar taking 64–224px, viewport breakpoints
    // consistently overestimate the space available and the grid ends up
    // cramped at exactly the widths where it should relax.
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <SearchResults />
    </div>
  );
}
