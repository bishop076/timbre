"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { NowPlayingPanel } from "../player/now-playing";
import { usePlayerControls } from "../player/player-context";
import { RemoteBar } from "../player/remote-bar";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { useSleepTimerDriver } from "../player/use-sleep-timer";
import { useRemotePlayer } from "../player/use-tab-sync";
import { useTransportKeys } from "../player/use-transport-keys";
import { TopBar } from "../top-bar";
import { PlayerBar } from "./player-bar";
import { BottomNav, Sidebar } from "./sidebar";
import { TabTitle } from "./tab-title";

// Whether this document has navigated at least once. Module scope because reading a ref
// during render and `setState` in an effect are both lint errors here; safe on the shared
// server module since it is only ever assigned from an effect.
let movedOnce = false;

/**
 * The app shell — rail, content panel and now-playing panel over a persistent player bar.
 * Expanding the video hides the content rather than covering it: an overlay would have to be
 * positioned against the player bar's height, which its contents set, so the two would
 * drift. `display: none` preserves search results and scroll position.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { theater, current } = usePlayerControls();
  // Another tab's song, shown only while this tab has none of its own — see `tab-sync.ts`.
  const remote = useRemotePlayer();
  const mirrored = current ? null : remote;
  const pathname = usePathname();

  // The page fades on a navigation and not on a first load. A CSS entry animation begins at
  // style resolution, not first paint, so on a cold load the 220ms fade is often finished
  // before anything is painted and the content appears at full opacity — a flash. That race
  // is decided by parsing, fonts and the bundle, so there is nothing to tune; the first
  // document does not animate. `movedOnce` latches, or coming back to the opening path
  // later would be missed.
  const [openedAt] = useState(pathname);
  const navigated = movedOnce || pathname !== openedAt;

  useEffect(() => {
    if (pathname !== openedAt) movedOnce = true;
  }, [pathname, openedAt]);

  // Applied from the shell, which always mounts. In `PlayerBar` nothing wrote the palette
  // until the first play, so a first visit wore the static CSS fallback and choosing a theme
  // updated only the picker — a control that looks outright broken.
  // A mirroring tab wears the other tab's cover too, so the two agree in colour as well.
  useArtworkAccent(current?.artworkUrl ?? mirrored?.report.song.artworkUrl);

  // Watched, not measured once: the answer changes on resize, on load and on navigation —
  // the panel element does not resize when its contents are swapped, hence `pathname`.
  const panel = useRef<HTMLElement>(null);
  // Assumed to scroll until measured otherwise: at `false` every page painted once without
  // the bottom fade and again with it, since measurement needs a layout. As `shelf.tsx`.
  const [overflowing, setOverflowing] = useState(true);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    // A pixel of slack: sub-pixel layout puts `scrollHeight` a hair above `clientHeight`.
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
      for (const child of element.children) observer.observe(child);

    return () => observer.disconnect();
  }, [pathname]);

  // `.ambient` lays a blurred cover under the content. Off on the profile page, whose own
  // header wash would be a second, unrelated colour field.
  const washed = !pathname.startsWith("/profile");

  useTransportKeys();
  useSleepTimerDriver();

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      /*
       * The height of everything pinned below the scrolling panel, published for the pages
       * that have to be at least as tall as that panel — `mt-auto` needs a column taller
       * than its content to push against, and `min-h-full` cannot supply one, because a
       * percentage min-height wants a definite height on every ancestor and the panel
       * offers none.
       *
       * Set here rather than in the stylesheet because only this component knows the
       * answer: the player bar is rendered by the line below and does not exist until
       * something has been played, so a page that hardcoded the subtraction was wrong in
       * one of the two states whichever number it picked. It was `--nav-h` alone, which
       * left `--bar-h` of dead scroll under the library for anyone listening to anything.
       *
       * Phone value. From `lg` the nav is hidden and the bar is a different height, so
       * every consumer stops using this at that breakpoint.
       *
       * The remote bar counts as the bar: it takes the player bar's place and is built to
       * the same height, so it borrows the same reservation rather than inventing one.
       */
      style={
        {
          "--chrome-b": current || mirrored
            ? "calc(var(--bar-h) + var(--nav-h) + var(--safe-b))"
            : "calc(var(--nav-h) + var(--safe-b))",
        } as React.CSSProperties
      }
    >
      <TabTitle />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/*
          No scrollbar — `scroll-fade` carries the whole job, and only when the panel
          actually scrolls: otherwise the fade has nothing to soften and merely dims the
          last thing on screen. Measured rather than listed by route.
        */}
        <main
          ref={panel}
          className={`${washed ? "ambient" : ""} ${overflowing ? "scroll-fade" : ""} scroller-quiet relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
            theater ? "hidden" : ""
          }`}
        >
          {/*
            Load-bearing: `.ambient`'s washes are *positioned* pseudo-elements, and a
            positioned element at `z-index: 0` paints above non-positioned in-flow
            content — so the cover became a film over every tile and heading.
          */}
          <div className="relative z-10">
            <TopBar />
            {/*
              `key` is what makes the animation play, and keying the inner wrapper is
              load-bearing: `<TopBar>` has to survive the navigation that typing in it
              triggers, and a key higher up would recreate the input mid-word.
            */}
            <div key={pathname} className={navigated ? "page-in" : undefined}>
              {children}
            </div>
          </div>
        </main>
        <NowPlayingPanel />
      </div>
      {/*
        `contents` rather than a wrapper element, so these stay direct flex children and
        keep measuring their own height, which `--bar-h` depends on. `current` is null only
        before the first play of a session — paused, finished and failed all keep it set —
        so this hides the empty bar without pulling controls from under a paused song.
      */}
      <div className={theater ? "hidden lg:contents" : "contents"}>
        {current && <PlayerBar />}
        {mirrored && <RemoteBar remote={mirrored} />}
        <BottomNav />
      </div>
    </div>
  );
}
