import { LibraryView } from "../playlists/library-view";

export const metadata = { title: "Your library — Timbre" };

/**
 * Playlists live in the reader's browser, so there is nothing to fetch here
 * and no session to read — this page is a shell around a client view.
 */
export default function LibraryPage() {
  return <LibraryView />;
}
