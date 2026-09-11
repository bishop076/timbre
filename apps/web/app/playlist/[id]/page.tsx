import { PlaylistView } from "../../playlists/playlist-view";

export default async function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaylistView id={id} />;
}
