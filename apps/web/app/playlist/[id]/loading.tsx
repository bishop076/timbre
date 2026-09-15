import { DetailSkeleton } from "@/app/album/detail-skeleton";

export default function PlaylistLoading() {
  return <DetailSkeleton rows={7} lines={2} thumb album />;
}
