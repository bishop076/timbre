"use client";

import { useState } from "react";

import { LibraryIcon, NoteIcon, SearchIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { sourceStyle } from "../sources";

/**
 * Primary navigation and library.
 *
 * Shaped after Spotify's rail, which is really two stacked panels: a short nav
 * block, then a titled region that owns the entire rest of the column and is
 * filled with **rows carrying artwork** — not an empty state, not a legend.
 * That density is most of what makes the shape recognisable, so the library
 * shows the live queue until there are saved playlists to show instead. A
 * sidebar that lists what you are actually listening to is more useful than one
 * apologising for being empty.
 *
 * Desktop only — below `lg` this is replaced by <BottomNav>, because a rail on
 * a phone spends the scarce axis and puts targets out of thumb reach.
 */

const NAV = [
  { id: "search", label: "Search", icon: SearchIcon, active: true },
  { id: "library", label: "Library", icon: LibraryIcon, active: false },
];

/** Sources that can currently be searched. Order matches the provider registry. */
const SOURCES = ["ytmusic", "deezer", "apple"] as const;

const FILTERS = ["Queue", "Playlists", "Artists"] as const;

export function Sidebar() {
  const { queue, current, play } = usePlayer();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Queue");

  const rows = filter === "Queue" ? queue : [];

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 p-2 lg:flex">
      <div className="flex items-center gap-2.5 px-3 py-4">
        <span
          className="slab-sm tint flex size-8 shrink-0 items-center justify-center rounded-[var(--r-md)] text-[var(--accent-fg)]"
          style={{ background: "var(--accent)" }}
        >
          <NoteIcon className="size-4.5" />
        </span>
        <span className="text-[17px] font-extrabold tracking-tight">Timbre</span>
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

      <div className="slab flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)]">
        <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
          <LibraryIcon className="size-[18px] shrink-0 text-[var(--fg-dim)]" />
          <span className="text-sm font-bold text-[var(--fg-dim)]">Your library</span>
          <span className="ml-auto text-xs font-semibold tabular-nums text-[var(--fg-faint)]">
            {rows.length || ""}
          </span>
        </div>

        {/* Filter chips, Spotify's affordance for slicing the library. Only the
            queue has anything behind it until accounts land, so the others
            disable rather than lie about being empty. */}
        <div className="flex gap-1.5 px-3 pb-3">
          {FILTERS.map((name) => {
            const selected = filter === name;
            const enabled = name === "Queue";
            return (
              <button
                key={name}
                type="button"
                disabled={!enabled}
                onClick={() => setFilter(name)}
                className={`press rounded-[var(--r-full)] px-2.5 py-1 text-[11px] font-bold ${
                  selected
                    ? "slab-sm tint text-[var(--accent-fg)]"
                    : "bg-[var(--surface-2)] text-[var(--fg-dim)] disabled:opacity-35"
                }`}
                style={selected ? { background: "var(--accent)" } : undefined}
              >
                {name}
              </button>
            );
          })}
        </div>

        <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {rows.length === 0 ? (
            <p className="px-2 py-6 text-xs leading-relaxed text-[var(--fg-faint)]">
              Nothing queued. Play something and it shows up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {rows.map((song) => {
                const isCurrent = current?.id === song.id;
                return (
                  <li key={song.id}>
                    <button
                      type="button"
                      onClick={() => play(song, rows)}
                      className={`flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 text-left ${
                        isCurrent ? "tint" : "hover:bg-[var(--surface-2)]"
                      }`}
                      style={isCurrent ? { background: "var(--accent-wash)" } : undefined}
                    >
                      <span className="slab-sm size-10 shrink-0 overflow-hidden rounded-[var(--r-sm)] bg-[var(--surface-2)]">
                        {song.artworkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                          <img
                            src={song.artworkUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center text-[var(--fg-faint)]">
                            <NoteIcon className="size-4" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13px] font-semibold ${
                            isCurrent ? "text-[var(--accent)]" : ""
                          }`}
                        >
                          {song.title}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--fg-dim)]">
                          {song.artists.join(", ") || "Unknown artist"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t-[length:var(--edge)] border-[var(--ink)] px-4 py-3">
          {SOURCES.map((id) => (
            <span key={id} className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)]">
              <span
                className="size-2 shrink-0 rounded-full border border-[var(--ink)]"
                style={{ backgroundColor: sourceStyle(id).color }}
              />
              {sourceStyle(id).short}
            </span>
          ))}
          <p className="w-full text-[10px] leading-relaxed text-[var(--fg-faint)]">
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
          className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
            item.active ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)] disabled:opacity-40"
          }`}
        >
          <item.icon className="size-[22px]" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}
