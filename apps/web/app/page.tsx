import { HomeView } from "./home-view";

export default function Home() {
  return (
    // @container so children size themselves against this column rather than
    // the viewport. With a sidebar taking 64–224px, viewport breakpoints
    // consistently overestimate the space available and the grid ends up
    // cramped at exactly the widths where it should relax.
    <div className="@container mx-auto w-full max-w-6xl px-5 pb-16 pt-5 sm:px-7 sm:pb-20">
      {/* The page has no visible title — the shelves name themselves — but a document with
          no `h1` gives a screen reader nothing to announce on arrival and nothing to jump
          to. Named for what the page is, not for the product. */}
      <h1 className="sr-only">Home — what’s playing now</h1>
      <HomeView />
    </div>
  );
}
