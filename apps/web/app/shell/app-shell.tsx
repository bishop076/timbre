"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { NowPlayingPanel } from "../player/now-playing";
import { usePlayer } from "../player/player-context";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { useTransportKeys } from "../player/use-transport-keys";
import { TopBar } from "../top-bar";
import { PlayerBar } from "./player-bar";
import { BottomNav, Sidebar } from "./sidebar";

/**
 * Whether this document has navigated at least once — see the note in `AppShell`.
 *
 * Module scope rather than a ref or state, and each of the alternatives is barred
 * for a reason: reading a ref during render and calling `setState` inside an
 * effect are both lint errors here, correctly, and this is neither React state nor
 * a subscription — it is one fact about the lifetime of the page.
 *
 * **Safe despite the module being shared across requests on the server**, because
 * it is only ever assigned from an effect, and effects do not run there. A server
 * render also always has `pathname === openedAt`, so there is nothing to latch.
 */
let movedOnce = false;

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
   * The page fades on a navigation and **not** on a first load.
   *
   * A CSS entry animation is only reliable for an element created while the page
   * is already live. On a fresh document it begins when styles resolve, not when
   * the browser first paints — so if the first paint lands after those 220ms have
   * elapsed, which is ordinary on a cold load, the fade is already finished and
   * the content simply appears at full opacity. That reads as a flash, and it is
   * the animation *failing to be seen* rather than the animation being wrong.
   *
   * There is no timing to tune here: whether the paint beats the animation is a
   * race with parsing, fonts and the bundle, and it is decided differently on
   * every load. So the first document does not animate at all. It does not need
   * to — every value that can be recorded is already correct in that frame; the
   * fade was never carrying it.
   *
   * The path this document opened at is captured once — `useState` with no setter
   * is the pure way to hold a value from the first render — and anything else is
   * a navigation. That comparison alone would miss coming *back* to the opening
   * path later, so `movedOnce` latches it; the `||` covers the first navigation
   * itself, which the effect is too late for.
   */
  const [openedAt] = useState(pathname);
  const navigated = movedOnce || pathname !== openedAt;

  useEffect(() => {
    if (pathname !== openedAt) movedOnce = true;
  }, [pathname, openedAt]);

  /*
   * The theme is applied here, and here is load-bearing.
   *
   * This lived in `PlayerBar`, which only mounts once something is playing —
   * so until the first play of a session, nothing wrote the palette onto the
   * document at all. The blocking script in `layout.tsx` stamps the ground from
   * storage at boot and then has no further say, which left two failures that
   * looked like different bugs and were the same one:
   *
   * - The interface wore the static CSS fallback rather than the ramp built
   *   from the reader's actual theme, so a first visit was never the app.
   * - Choosing a theme did nothing visible. The picker updated — the check
   *   moved, the previews repainted, since those read React state — while the
   *   document kept the ground it booted with. Selecting "Album" on a page that
   *   booted light left Album selected *and* the page light, which reads as an
   *   outright broken control.
   *
   * The shell always mounts, so the document and the store can no longer
   * disagree. Nothing about the artwork sampling changes: with no track it is
   * passed `undefined` and applies the ramp with no swatch, which is the case
   * the palette already handles for a cover it cannot read.
   */
  useArtworkAccent(current?.artworkUrl);

  /*
   * Whether the content panel has more below its edge.
   *
   * Watched rather than measured once: the answer changes when the window
   * resizes, when a shelf finishes loading, and on every navigation. The
   * observer covers the first two; `pathname` covers the third, since the
   * panel element itself does not change size when its contents are swapped
   * for a different page's.
   */
  const panel = useRef<HTMLElement>(null);
  /*
   * Assumed to scroll until measured otherwise, which is the opposite of what
   * this started as and the reason it is written down.
   *
   * Starting at `false` meant every page painted once without the bottom fade
   * and again with it, because the measurement can only happen after a layout
   * exists. That is a visible change of state on a page that had not finished
   * arriving — one more flicker on top of the ones already being chased.
   *
   * Most pages do overflow, so `true` is both the commoner answer and the safer
   * guess: being wrong turns the fade *off* a frame later on a short page,
   * which is far less noticeable than it appearing on a long one. Same
   * reasoning as `canRight` in `shelf.tsx`.
   */
  const [overflowing, setOverflowing] = useState(true);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    // A pixel of slack: sub-pixel layout leaves `scrollHeight` a hair above
    // `clientHeight` on pages that do not scroll at all, and a fade that only
    // appears on some of those is worse than one that never does.
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The panel's own box rarely changes; its contents are what grow when a
    // chart or a shelf arrives, so the child is the one worth watching.
    for (const child of element.children) observer.observe(child);

    return () => observer.disconnect();
  }, [pathname]);

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
        {/*
          The fade is drawn only when the panel actually scrolls.

          Its one job is to soften a row sliced through by the bottom edge. A
          page whose content ends before that edge has nothing to slice, so the
          fade had nothing to do but dim the last thing on screen — on the
          library that is the About and Privacy links, greyed out for no reason
          anybody could see.

          Measured rather than listed by route. A list would be wrong the moment
          a page's content changed length, which is most of them: the library
          overflows once you have a dozen playlists, and should get its fade
          back at exactly that point without anyone remembering to say so.
        */}
        <main
          ref={panel}
          className={`${washed ? "ambient" : ""} ${overflowing ? "scroll-fade" : ""} scroller-quiet relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
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
          {/*
            The search field sits above the routed page, not inside it.

            That is what lets typing on Home carry you to the results without
            the input being unmounted by the navigation it triggers — the caret
            and the next keystroke survive because the element does. See
            `top-bar.tsx`.
          */}
          <div className="relative z-10">
            <TopBar />
            {/*
              The routed page fades in on a navigation, and the bar above it does
              not — it does not go anywhere when the page changes.

              `key` is what makes the animation play: it runs when its element is
              created, so reusing the node across routes would fire it once and
              never again. Keying the *inner* wrapper rather than this one is
              load-bearing — `<TopBar>` has to survive the navigation that typing
              in it triggers, and a key here would recreate the input mid-word.

              A plain block inside a plain block, so it adds nothing to the
              layout: the pages below set their own height and padding exactly as
              they did.
            */}
            <div key={pathname} className={navigated ? "page-in" : undefined}>
              {children}
            </div>
          </div>
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
