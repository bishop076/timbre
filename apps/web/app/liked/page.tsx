import { LikedView } from "./liked-view";

export const metadata = { title: "Liked songs — Timbre" };

/**
 * Liked songs live in the reader's browser, so there is nothing to fetch here and no
 * session to read — a shell around a client view, like the library.
 *
 * Which is also why the service worker may cache it, unlike `/profile`: the HTML the server
 * sends is the same for everyone — "Loading…" until the browser reads its own storage — so
 * no liked song ever passes through the server, let alone into a cache.
 */
export default function LikedPage() {
  return <LikedView />;
}
