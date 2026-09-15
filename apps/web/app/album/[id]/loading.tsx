import { DetailSkeleton } from "@/app/album/detail-skeleton";

export default function AlbumLoading() {
  // One line per row: `AlbumView` only prints an artist under a title when that track's credit
  // differs from the album's, which on most releases is never. Ten rows covers a typical LP.
  return <DetailSkeleton rows={10} lines={1} />;
}
