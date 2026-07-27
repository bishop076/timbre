"use client";

import type { ReactNode } from "react";

import { NowPlayingPanel } from "../player/now-playing";
import { usePlayer } from "../player/player-context";
import { PlayerBar } from "./player-bar";
import { BottomNav, Sidebar } from "./sidebar";

/**
 * The app shell.
 *
 * Three columns on desktop — library rail, content, now-playing panel — over a
 * persistent player bar. That is Spotify's arrangement, and the third column is
 * the part that makes it one: without it, a music app is just a page with a bar
 * stuck to the bottom.
 *
 * The content panel is **inset as its own rounded slab** rather than running to
 * the window edges. The gap is what separates "an app" from "a web page": the
 * ground shows through, and the ambient wash from the current artwork lives in
 * that gap.
 *
 * Expanding the video hides the content rather than covering it. An overlay
 * would have to be positioned against the player bar's height in CSS, and that
 * height is set by its contents — so the two would drift apart the moment
 * either changed. Hiding a flex sibling instead lets the bar keep measuring
 * itself. The content is only display-hidden, so search results and scroll
 * position are still there when the video collapses.
 *
 * Phones get a different shape rather than a squeezed one: the rail becomes a
 * bottom nav, the panel becomes a floating card, and the player collapses to a
 * mini bar — all in thumb reach.
 *
 * A client component because the whole arrangement depends on player state.
 * `children` stays a server component; it is passed through untouched.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { theater } = usePlayer();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          className={`ambient scroller relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
            theater ? "hidden" : ""
          }`}
        >
          {children}
        </main>
        <NowPlayingPanel />
      </div>
      <PlayerBar />
      <BottomNav />
    </div>
  );
}
