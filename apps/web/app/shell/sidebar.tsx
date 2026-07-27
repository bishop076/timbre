"use client";

import { LibraryIcon, NoteIcon, SearchIcon } from "../icons";
import { sourceStyle } from "../sources";

/**
 * Primary navigation.
 *
 * Desktop only — below `lg` this is replaced by <BottomNav>, because an icon
 * rail on a phone wastes the horizontal space that matters most and puts the
 * targets where thumbs cannot reach. Two different shapes for two different
 * hands, rather than one shape squeezed.
 */

const NAV = [
  { id: "search", label: "Search", icon: SearchIcon, active: true },
  { id: "library", label: "Library", icon: LibraryIcon, active: false },
];

/** Sources that can currently be searched. Order matches the provider registry. */
const SOURCES = ["ytmusic", "deezer", "apple"] as const;

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-2 p-2 lg:flex">
      <div className="flex items-center gap-2.5 px-3 py-4">
        <span
          className="slab-sm tint flex size-8 shrink-0 items-center justify-center rounded-[var(--r-md)] text-[var(--accent-fg)]"
          style={{ background: "var(--accent)" }}
        >
          <NoteIcon className="size-4.5" />
        </span>
        <span className="text-[17px] font-semibold tracking-tight">Timbre</span>
      </div>

      <nav className="slab flex flex-col gap-1 rounded-[var(--r-lg)] bg-[var(--surface-1)] p-2">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={!item.active}
            aria-current={item.active ? "page" : undefined}
            className={`press flex items-center gap-3.5 rounded-[var(--r-md)] px-3 py-2.5 text-sm font-semibold ${
              item.active
                ? "slab-sm tint text-[var(--accent-fg)]"
                : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            }`}
            style={item.active ? { background: "var(--accent)" } : undefined}
          >
            <item.icon className="size-[18px] shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* The tall panel, Spotify's shape: a titled region that owns the rest of
          the column. It holds the library once there is one; until then it
          states what Timbre actually is, which is the more useful thing to put
          in front of someone on their first visit. */}
      <div className="slab flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)]">
        <div className="flex items-center gap-3 px-4 pb-2 pt-4">
          <LibraryIcon className="size-[18px] shrink-0 text-[var(--fg-dim)]" />
          <span className="text-sm font-semibold text-[var(--fg-dim)]">Your library</span>
        </div>

        <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] p-4">
            <p className="text-sm font-semibold">Nothing saved yet</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-dim)]">
              Playlists live here once accounts land. Search something in the meantime.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-[var(--line)] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-faint)]">
            Searching
          </p>
          {SOURCES.map((id) => (
            <span key={id} className="flex items-center gap-2.5 text-xs text-[var(--fg-dim)]">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: sourceStyle(id).color }}
              />
              {sourceStyle(id).label}
            </span>
          ))}
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-faint)]">
            Timbre hosts nothing. Every track plays from the service it belongs to.
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * Mobile navigation.
 *
 * Sits below the mini player so the two stack into one thumb-reachable block at
 * the bottom of the screen, which is where phone music apps put them.
 */
export function BottomNav() {
  return (
    <nav className="flex h-[var(--nav-h)] shrink-0 items-stretch border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] lg:hidden">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          disabled={!item.active}
          aria-current={item.active ? "page" : undefined}
          className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
            item.active
              ? "tint text-[var(--accent)]"
              : "text-[var(--fg-faint)] disabled:opacity-40"
          }`}
        >
          <item.icon className="size-[22px]" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}
