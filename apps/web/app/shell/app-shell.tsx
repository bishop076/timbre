"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MAIN_ID } from "../a11y/skip-link";
import { CloseIcon, SearchIcon } from "../icons";
import { NOW_PLAYING_ID, NowPlayingPanel } from "../player/now-playing";
import { usePlayerControls } from "../player/player-context";
import { RemoteBar } from "../player/remote-bar";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { useSleepTimerDriver } from "../player/use-sleep-timer";
import { useRemotePlayer } from "../player/use-tab-sync";
import { useTransportKeys } from "../player/use-transport-keys";
import { setSearchQuery, useSearchQuery } from "../search-store";
import { SearchSuggestions } from "../search-suggestions";
import { searchPath } from "../search-url";
import {
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_RESIST,
  PANEL_MIN,
  panelPaintWidth,
  panelCollapsesAt,
  resolvePanelWidth,
  roomFor,
  savePanelWidth,
  usePanelWidth,
  useRailWidth,
} from "./pane-size.ts";
import { PlayerBar } from "./player-bar";
import { ResizeHandle, useViewportWidth } from "./resize-handle";
import { BottomNav, ProfileButton, Sidebar } from "./sidebar";

let movedOnce = false;

// icons.tsx is not ours to grow, and nothing in it means "the rail". A panel with its first
// column ruled off is the glyph both Spotify and the Music app use for this.
const SUGGESTIONS_ID = "search-suggestions";
const SEARCH_HINT_ID = "search-hint";

const barButton =
  "press flex size-8 shrink-0 items-center justify-center rounded-[var(--r-md)] text-[var(--fg-dim)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-35";

/** The one bar that outlives the page under it: history, search and your profile, reachable
 * from every route. Search used to live on three of them and vanish on the rest, so getting
 * back to it from an album meant navigating away first. */
function ShellBar() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchQuery();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const early = input.current?.value;
    if (early && !query) change(early);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
      if (event.key === "Escape" && typing) input.current?.blur();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function change(value: string) {
    setSearchQuery(value);
    // Arriving at /search is one history entry; typing once you are there is none. Keystrokes
    // use replaceState rather than router.replace so the address bar keeps up without asking
    // the server for the route again on every letter.
    if (pathname !== "/search") {
      if (value.trim()) router.push(searchPath(value));
    } else {
      window.history.replaceState(null, "", searchPath(value));
    }
  }

  const showSuggestions = focused && !query.trim();

  // The bar is the search box. History and profile are small and sit at the ends; everything
  // between them belongs to the field, so it grows with the window instead of being pinned to a
  // fixed width with dead space either side.
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-1)_86%,transparent)] px-2.5 backdrop-blur-md sm:px-4">
      <div
        className="relative min-w-0 flex-1"
        onFocus={() => setFocused(true)}
        // The chips live inside this wrapper now, so arrowing into one is still focus staying
        // put. Only focus leaving the whole box closes it.
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-[var(--fg-faint)]" />
        <input
          ref={input}
          // Named so the browser stops flagging an unidentified field, and so its
          // session restore and autofill have something stable to key the box on.
          name="q"
          type="search"
          value={query}
          onChange={(event) => change(event.target.value)}
          placeholder="Search songs, artists or a link…"
          aria-label="Search for a song"
          aria-describedby={showSuggestions ? SEARCH_HINT_ID : undefined}
          onKeyDown={(event) => {
            // Down arrow drops into the suggestion chips. Without it the only way to reach
            // them is Tab, which walks past the clear button and the profile menu first.
            if (event.key !== "ArrowDown" || !showSuggestions) return;
            const first = document
              .getElementById(SUGGESTIONS_ID)
              ?.querySelector<HTMLElement>("button");
            if (!first) return;
            event.preventDefault();
            first.focus();
          }}
          // A hairline, not a `.slab` edge: `.slab-soft` is unlayered and would outrank the
          // focus colour below, and a 2px frame on a 36px field is the toy look we are losing.
          className="h-9 w-full rounded-[var(--r-full)] border border-[var(--line)] bg-[var(--surface-2)] pl-9 pr-10 text-[length:var(--text-body)] font-medium outline-none transition-colors placeholder:text-[var(--fg-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface-1)]"
        />

        {query ? (
          <button
            type="button"
            onClick={() => {
              change("");
              input.current?.focus();
            }}
            aria-label="Clear search"
            className="press absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
          >
            <CloseIcon className="size-3.5" />
          </button>
        ) : null}

        {showSuggestions && (
          <div className="slab rise absolute inset-x-0 top-full z-20 mt-1.5 rounded-[var(--r-lg)] bg-[var(--surface-1)] px-2.5 py-2 shadow-[var(--drop-lg)]">
            <p id={SEARCH_HINT_ID} className="sr-only">
              Suggested searches are below. Press the down arrow to reach them.
            </p>
            <SearchSuggestions id={SUGGESTIONS_ID} onExit={() => input.current?.focus()} />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1 pl-2">
        <ProfileButton />
      </div>
    </header>
  );
}

/** The now-playing panel's left edge. Zero width of its own: it is pinned over the gap the main
 *  column's right margin already leaves, so the row is laid out exactly as it was before. */
function PanelEdge() {
  const width = usePanelWidth();
  const rail = useRailWidth();
  const viewport = useViewportWidth();
  // `togglePanel` rather than a close action of its own: player-context owns that state and is
  // being edited elsewhere, and the edge only ever fires this while the panel is open.
  const { panelOpen, togglePanel } = usePlayerControls();

  // The rail is already taking its share of the row, so the panel's ceiling is what is left of
  // the window once the rail and the main column's minimum have been paid for.
  const ceiling = roomFor(viewport, rail, { max: PANEL_MAX, floor: PANEL_MIN });

  return (
    <div className="relative hidden w-0 shrink-0 xl:block">
      <ResizeHandle
        controls={NOW_PLAYING_ID}
        label="Resize the now playing panel"
        variable="--np-w"
        width={width}
        // Far enough under the panel's own floor that the resistance band and the collapse past
        // it are both reachable; a handle clamped at PANEL_MIN could never report a width below
        // it, and one clamped inside the band could never get through it.
        min={PANEL_MIN - PANEL_RESIST - 40}
        max={ceiling}
        reset={PANEL_DEFAULT}
        direction={-1}
        resolve={(raw) => panelPaintWidth(raw, ceiling)}
        onCommit={(next) => {
          if (panelCollapsesAt(next)) {
            // Undo the imperative paint by hand.
            //
            // The handle writes --np-w straight to the DOM during a drag and relies on React
            // taking ownership back at the next commit. That works when the width is saved,
            // because the store changes and React renders a different value. A collapse
            // deliberately does NOT save — so React's own value is unchanged, its diff sees
            // nothing to do, and the rail-sized width it painted mid-drag stays on the element.
            // Reopening then gave you a 28px panel with the text squeezed out of it.
            document.getElementById(NOW_PLAYING_ID)?.style.setProperty("--np-w", `${width}px`);
            if (panelOpen) togglePanel();
            return;
          }
          savePanelWidth(next);
        }}
        className="-left-2 bottom-2 top-2"
      />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { theater, current, panelOpen } = usePlayerControls();
  const remote = useRemotePlayer();
  const mirrored = current ? null : remote;
  const pathname = usePathname();

  const [openedAt] = useState(pathname);
  const navigated = movedOnce || pathname !== openedAt;

  useEffect(() => {
    if (pathname !== openedAt) movedOnce = true;
  }, [pathname, openedAt]);

  useArtworkAccent(current?.artworkUrl ?? mirrored?.report.song.artworkUrl);
  useTransportKeys();
  useSleepTimerDriver();

  // Only while something is playing. This used to fall back to a constant "Timbre" when idle, and
  // because a MutationObserver re-applied it on every write to <head>, it did not merely race the
  // route's own metadata — it overwrote it and kept overwriting it. The server sends
  // "Your listening — Timbre" for /stats and the tab read "Timbre", on every route, on a hard
  // load and on a client navigation, so every bookmark and history entry said the same word.
  //
  // The observer earns its place for the playing case: Next rewrites <head> on navigation, and a
  // one-shot assignment would be undone the moment you changed page mid-track. When nothing is
  // playing there is nothing to defend, so it does not run at all and the route keeps its title.
  const nowPlayingTitle = current ? `Timbre · ${current.title}` : null;
  useEffect(() => {
    if (!nowPlayingTitle) return;
    const apply = () => {
      if (document.title !== nowPlayingTitle) document.title = nowPlayingTitle;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [nowPlayingTitle]);

  const panel = useRef<HTMLElement>(null);
  const [overflowing, setOverflowing] = useState(true);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={
        {
          "--chrome-b": current || mirrored
            ? "calc(var(--bar-h) + var(--nav-h) + var(--safe-b))"
            : "calc(var(--nav-h) + var(--safe-b))",
        } as React.CSSProperties
      }
    >
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          ref={panel}
          // The skip link's `href="#main-content"` needs something to point at. It has a
          // JS fallback that finds `<main>` by tag, but a fragment that resolves on its own
          // survives the handler not running — and a link to a dangling id is the kind of
          // thing an audit passes and a reader does not.
          id={MAIN_ID}
          className={`${pathname.startsWith("/profile") ? "" : "ambient"} ${overflowing ? "scroll-fade" : ""} scroller-quiet relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
            theater ? "hidden" : ""
          }`}
        >
          <div className="relative z-10">
            <ShellBar />
            <div key={pathname} className={navigated ? "page-in" : undefined}>
              {children}
            </div>
          </div>
        </main>
        {current && panelOpen && !theater && <PanelEdge />}
        <NowPlayingPanel />
      </div>
      <div className={theater ? "hidden lg:contents" : "contents"}>
        <PlayerBar />
        {mirrored && <RemoteBar remote={mirrored} />}
        <BottomNav />
      </div>
    </div>
  );
}
