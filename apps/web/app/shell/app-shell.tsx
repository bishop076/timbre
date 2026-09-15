"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronIcon, CloseIcon, SearchIcon } from "../icons";
import { NowPlayingPanel } from "../player/now-playing";
import { usePlayerControls } from "../player/player-context";
import { RemoteBar } from "../player/remote-bar";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { useSleepTimerDriver } from "../player/use-sleep-timer";
import { useRemotePlayer } from "../player/use-tab-sync";
import { useTransportKeys } from "../player/use-transport-keys";
import { setSearchQuery, useSearchQuery } from "../search-store";
import { SearchSuggestions } from "../search-suggestions";
import { searchPath } from "../search-url";
import { PlayerBar } from "./player-bar";
import { BottomNav, ProfileButton, Sidebar, toggleRail, useRailCollapsed } from "./sidebar";

let movedOnce = false;

// icons.tsx is not ours to grow, and nothing in it means "the rail". A panel with its first
// column ruled off is the glyph both Spotify and the Music app use for this.
function RailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

const SUGGESTIONS_ID = "search-suggestions";
const SEARCH_HINT_ID = "search-hint";

const barButton =
  "press flex size-8 shrink-0 items-center justify-center rounded-[var(--r-md)] text-[var(--fg-dim)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-35";

/** The one bar that outlives the page under it: history, search and your profile, reachable
 * from every route. Search used to live on three of them and vanish on the rest, so getting
 * back to it from an album meant navigating away first. */
function ShellBar({ canGoBack }: { canGoBack: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchQuery();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const collapsed = useRailCollapsed();

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

  // Three columns, not a flex row. In a row the search box sits wherever the buttons to its left
  // happen to end, so it drifts left and moves whenever a control appears or disappears. A grid
  // with equal outer columns puts it on the bar's true centre line and keeps it there — the same
  // fix the player transport got.
  return (
    <header className="sticky top-0 z-30 grid h-12 shrink-0 grid-cols-[1fr_minmax(0,48rem)_1fr] items-center gap-2 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--surface-1)_86%,transparent)] px-2.5 backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={toggleRail}
        aria-label={collapsed ? "Show the sidebar" : "Collapse the sidebar"}
        aria-pressed={!collapsed}
        className={`${barButton} mr-0.5 hidden xl:flex ${collapsed ? "" : "text-[var(--fg)]"}`}
      >
        <RailIcon className="size-[18px]" />
      </button>

      <button
        type="button"
        onClick={() => router.back()}
        disabled={!canGoBack}
        aria-label="Back"
        className={`${barButton} hidden sm:flex`}
      >
        <ChevronIcon className="size-[18px] rotate-90" />
      </button>
      <button
        type="button"
        onClick={() => router.forward()}
        aria-label="Forward"
        className={`${barButton} mr-1 hidden sm:flex`}
      >
        <ChevronIcon className="size-[18px] -rotate-90" />
      </button>

      </div>

      <div
        className="relative min-w-0"
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

export function AppShell({ children }: { children: ReactNode }) {
  const { theater, current } = usePlayerControls();
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
          className={`${pathname.startsWith("/profile") ? "" : "ambient"} ${overflowing ? "scroll-fade" : ""} scroller-quiet relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
            theater ? "hidden" : ""
          }`}
        >
          <div className="relative z-10">
            <ShellBar canGoBack={navigated} />
            <div key={pathname} className={navigated ? "page-in" : undefined}>
              {children}
            </div>
          </div>
        </main>
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
