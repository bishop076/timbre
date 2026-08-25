"use client";

import { useEffect } from "react";

import { usePlayerControls } from "../player/player-context";

/**
 * The tab's text. Two states and no more: `Timbre` on its own, and `Timbre · <song>` once
 * something is loaded — paused included, since `current` outlives a pause.
 *
 * The artist is deliberately left out. A tab shows roughly twenty characters before it
 * clips, and a title plus an artist spends all of them before the song is legible.
 *
 * **Why this owns `document.title` instead of going through `metadata`.** Route titles are
 * still exported — they are what a crawler and a bookmark read, and "Explore — Timbre" is
 * the right answer for both — but none of them can know what is playing. So the tab is
 * client-owned and the route titles stay server-side. The observer is what makes that
 * stick: `generateMetadata` on the album and artist routes awaits a fetch, so its title
 * lands *after* this effect has run and would otherwise overwrite it. Re-applying on any
 * head mutation covers that without racing it. Setting the same string is a no-op, so the
 * observer cannot drive itself.
 */
export function TabTitle() {
  const { current } = usePlayerControls();
  const title = current ? `Timbre · ${current.title}` : "Timbre";

  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };

    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, [title]);

  return null;
}
