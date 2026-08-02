import { PlaylistView } from "../../playlists/playlist-view";

/**
 * One playlist.
 *
 * A thin client shell rather than a server page: the playlist lives in the
 * reader's browser, so there is nothing for the server to fetch and no session
 * to check. It used to redirect to sign-in and 404 on someone else's id —
 * neither can happen now, because there is no "someone else".
 */
export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaylistView id={id} />;
}
