"use client";

import { toArtistSlug } from "./artist-slug";
import { useRouter } from "next/navigation";

export function ArtistLink({
  artists,
  className = "",
}: {
  artists: string[];
  className?: string;
}) {
  const router = useRouter();
  const primary = artists[0];

  if (!primary) return <span className={className}>Unknown artist</span>;

  function go(event: React.MouseEvent | React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    router.push(`/artist/${toArtistSlug(primary!)}`);
  }

  return (
    <span
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") go(event);
      }}
      title={`Go to ${primary}`}
      className={`cursor-pointer hover:text-[var(--fg)] hover:underline ${className}`}
    >
      {artists.join(", ")}
    </span>
  );
}
