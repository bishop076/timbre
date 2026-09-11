import { StatsView } from "./stats-view";

export const metadata = { title: "Your listening — Timbre" };

/**
 * What this browser has played, counted. The plays live in the reader's browser, so there is
 * nothing to fetch and nothing personal in this page's markup — it is a shell around a client
 * view, the same for every request, and safe for the service worker to keep like any other.
 */
export default function StatsPage() {
  return <StatsView />;
}
