"use client";

import { toArtistSlug } from "./artist-slug";
import { useRouter } from "next/navigation";

/**
 * An artist's name, clickable through to their page — a span that navigates, not an `<a>`,
 * because the name sits inside the button that plays the song and an anchor inside a button
 * is invalid HTML: browsers drop the inner element, leaving one unlabelled target where
 * there should be two. `role="link"` and a keyboard handler cover everything but a mouse.
 * The cost is a name that cannot be middle-clicked or copied as a link.
 */
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
    // Stops the row's play button from firing on the way past.
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
