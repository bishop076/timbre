"use client";

import { LibraryIcon, NoteIcon, SearchIcon } from "../icons";

/**
 * Primary navigation.
 *
 * Collapses to an icon rail on narrow screens rather than disappearing, so the
 * app keeps its shape on a phone instead of turning back into a single column.
 */

const NAV = [
  { id: "search", label: "Search", icon: SearchIcon, active: true },
  { id: "library", label: "Library", icon: LibraryIcon, active: false },
];

export function Sidebar() {
  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] lg:w-56">
      <div className="flex h-16 items-center gap-2.5 px-4 lg:px-5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)]">
          <NoteIcon className="size-4.5" />
        </span>
        <span className="hidden text-lg font-semibold tracking-tight lg:block">Timbre</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2 lg:px-3">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={!item.active}
            aria-current={item.active ? "page" : undefined}
            title={item.label}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              item.active
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            }`}
          >
            <item.icon className="size-5 shrink-0" />
            <span className="hidden lg:block">{item.label}</span>
          </button>
        ))}
      </nav>

      <p className="hidden px-5 pb-5 text-[11px] leading-relaxed text-[var(--muted)] lg:block">
        Timbre hosts nothing. Every track plays from the service it belongs to.
      </p>
    </aside>
  );
}
