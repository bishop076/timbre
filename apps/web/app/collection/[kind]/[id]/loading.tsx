import { DetailSkeleton } from "@/app/album/detail-skeleton";

export default function CollectionLoading() {
  // Two lines and artwork: a chart is a different artist every row, and every row shows its
  // cover. The three note lines are the "assembled from … and kept nowhere" paragraph at the
  // height `CollectionView` reserves for it, which is part of the header and so part of this.
  return <DetailSkeleton rows={6} lines={2} thumb album note={3} />;
}
