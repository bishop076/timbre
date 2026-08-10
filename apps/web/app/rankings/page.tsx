import { redirect } from "next/navigation";

/**
 * Charts live on Explore now.
 *
 * Kept as a redirect rather than deleted: the route was linked from cards and
 * from the nav for a while, and a dead address is a worse answer than the page
 * that absorbed it.
 */
export default function RankingsPage() {
  redirect("/explore");
}
