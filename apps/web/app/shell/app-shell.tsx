"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { NowPlayingPanel } from "../player/now-playing";
import { usePlayer } from "../player/player-context";
import { useTransportKeys } from "../player/use-transport-keys";
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
  const { theater, current } = usePlayer();
  const pathname = usePathname();

  /*
   * The album wash belongs where music is being browsed, not everywhere.
   *
   * `.ambient` lays a blurred copy of the current cover under the content. On a
   * shelf of artwork that reads as light coming off what is playing; on the
   * profile page — which has its own header wash taken from the reader's
   * picture — it is a second, unrelated colour field bleeding in underneath,
   * and the two fight. Settings pages are for reading, so they get a plain
   * ground.
   */
  const washed = !pathname.startsWith("/profile");

  // Mounted here rather than in the player bar because these keys have to work
  // on every page, and the bar is the one component guaranteed to be present —
  // but it is also collapsed to a mini bar on phones, where its subtree is a
  // poor place to hang a global listener.
  useTransportKeys();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/*
          No scrollbar of any kind, native or drawn.

          Four attempts at one — restyled, then rebuilt from scratch — and each
          was more distracting than the thing it was meant to help with. The
          panel is one continuous surface and a bar down its edge fights that,
          so `scroll-fade` carries the whole job instead: content dissolves at
          the bottom edge, which says "there is more" without drawing a rail
          over the artwork to say it.

          Scrolling is untouched — wheel, trackpad, touch, keyboard, drag-select
          and Page Up/Down all behave exactly as before.
        */}
        <main
          className={`${washed ? "ambient" : ""} scroll-fade scroller-quiet relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
            theater ? "hidden" : ""
          }`}
        >
          {/*
            Content sits above both ambient layers.

            Load-bearing: `.ambient`'s washes are *positioned* pseudo-elements,
            and a positioned element at `z-index: 0` paints **above**
            non-positioned in-flow content. While the wash was a barely-there
            tint that went unnoticed; the moment it carried the cover it became
            a film over every tile and heading. Giving the content its own
            stacking position is what puts the wash behind it, where a backdrop
            belongs.
          */}
          <div className="relative z-10">{children}</div>
        </main>
        <NowPlayingPanel />
      </div>
      {/*
        Expanded on a phone, the player carries its own transport — so the mini
        bar and the nav below it would be a second set of the same controls
        competing for the same thumb. `contents` rather than a wrapper element,
        so when they *are* shown these stay direct flex children of the column
        and keep measuring their own height, which `--bar-h` depends on.
      */}
      {/*
        The bar appears once there is something to control, and never leaves.

        `current` is null only before the first play of a session — a paused
        song, a finished one and a failed one all keep it set — so this hides
        the empty "Nothing playing" bar on a first visit without ever pulling
        the controls out from under a song someone paused. Hiding on *paused*
        would be the obvious reading of the same idea and exactly wrong: the
        moment you most need a play button is right after you press pause.

        The nav is not conditional. It is navigation, and a bottom bar that
        appears only after you play something is a bottom bar people never find.
      */}
      <div className={theater ? "hidden lg:contents" : "contents"}>
        {current && <PlayerBar />}
        <BottomNav />
      </div>
    </div>
  );
}
