import { fetchGenres } from "@/lib/discover";

import { StatsView } from "./stats-view";

export const metadata = { title: "Your listening — Timbre" };

// Genre names change about never. This is a page of numbers held in the browser; the one thing on
// it that is not already there gets the longest cache the route can have.
export const revalidate = 86_400;

export default async function StatsPage() {
  // The taste book in localStorage stores a Deezer genre *id* per artist and no name, so the
  // spread needs the lookup table — one `/genre` call, cached for a week underneath this.
  // `deezerList` forgives an outage into an empty array rather than throwing, and an empty table
  // leaves every other section on the page exactly as it was: the genre panel says it has nothing
  // to place yet, which is the truth.
  const genres = await fetchGenres();

  return <StatsView genreNames={Object.fromEntries(genres.map(({ id, name }) => [id, name]))} />;
}
