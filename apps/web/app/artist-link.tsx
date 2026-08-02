"use client";

import { toArtistSlug } from "./artist-slug";
import { useRouter } from "next/navigation";

/**
 * An artist's name, clickable through to their Timbre page.
 *
 * **Not an `<a>`, and that is the whole point.** Every place a song's artist is
 * shown, the name sits inside the button that plays the song — and an anchor
 * inside a button is invalid HTML. Browsers drop the inner element, and
 * assistive technology is left with one unlabelled target where there should be
 * two. Restructuring every row to hoist the name out would mean rebuilding four
 * layouts that already work.
 *
 * So this is a span that navigates: the click is stopped before it reaches the
 * enclosing button, and the router is called directly. It carries `role="link"`
 * and a keyboard handler so it behaves like one for anything that is not a
 * mouse.
 *
 * The cost is an artist name that cannot be middle-clicked or copied as a link.
 * That is worth less than the row still playing when you click anywhere else on
 * it, which is what a real anchor would have broken.
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
