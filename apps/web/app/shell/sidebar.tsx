"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Artwork } from "../artwork";
import { useHydrated } from "../hydrated";
import { CompassIcon, HomeIcon, LibraryIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { PlaylistCover } from "../playlists/playlist-cover";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
import { Avatar } from "../profile/avatar";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { SiteLinks } from "./site-links";

/** Primary navigation and library: a nav block, then a titled region of artwork rows that
 * owns the rest of the column, showing the live queue until playlists are saved. Desktop
 * only — below `lg` this is replaced by <BottomNav>. */

// Search is not a tab: the field lives in the shell, so it is on every page already.
const NAV = [
  { id: "home", label: "Home", icon: HomeIcon, href: "/" },
  { id: "explore", label: "Explore", icon: CompassIcon, href: "/explore" },
  { id: "library", label: "Library", icon: LibraryIcon, href: "/library" },
];

const FILTERS = ["Queue", "Playlists"] as const;

export function Sidebar() {
  const { queue, current, play, exitTheater } = usePlayerControls();
  const profile = useLocalProfile();
  const pictures = useLocalImages();
  const hydrated = useHydrated();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Queue");
  const { playlists, settled } = usePlaylists();
  const pathname = usePathname();

  // Loaded once and shared with every "add to playlist" menu, so the chip is instant.
  useEffect(() => {
    void loadPlaylists();
  }, []);

  const rows = filter === "Queue" ? queue : [];

  // `pb-1.5`: the library panel is `flex-1`, so it can only be handed space from above —
  // a dozen pixels decides whether the last row is cut in half.
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-1.5 p-2 pb-1.5 lg:flex">
      <Link
        href="/profile"
        onClick={exitTheater}
        className="press relative mb-0.5 flex items-center gap-2.5 overflow-hidden rounded-[var(--r-lg)] px-3 py-2.5 hover:bg-[var(--surface-1)]"
      >
        {/* Drawn on the first paint, not after hydration: rendering nothing until storage
            could be read collapsed this row to its padding, dropping the whole rail 32px and
            snapping it back on every load. Values are stamped on `<html>` by `layout.tsx`. */}
        <Avatar
          id={profile.id}
          name={profile.name}
          email={profile.name ?? "Profile"}
          image={pictures.avatar}
          className="size-8 shrink-0"
          textClassName="text-sm"
        />
        {/* Empty until hydration, filled from CSS meanwhile: no wrong name, and no hole. */}
        <span
          className="replay truncate text-[17px] font-extrabold tracking-tight"
          style={{ "--replay": 'var(--profile-name, "Profile")' } as React.CSSProperties}
        >
          {hydrated ? profile.name?.trim() || "Profile" : null}
        </span>
      </Link>

      {/* Library is filtered out here: the panel below *is* the library, so a nav button of
          the same name sits a centimetre from its heading. <BottomNav> still shows it. */}
      <nav className="slab flex flex-col gap-1 rounded-[var(--r-lg)] bg-[var(--surface-1)] p-2">
        {NAV.filter((item) => item.id !== "library").map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={exitTheater}
              aria-current={active ? "page" : undefined}
              className={`press flex items-center gap-3.5 rounded-[var(--r-md)] px-3 py-2.5 text-sm font-semibold ${
                active
                  ? "slab-sm tint text-[var(--accent-fg)]"
                  : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              }`}
              style={active ? { background: "var(--accent)" } : undefined}
            >
              <item.icon className="size-[18px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="slab flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)]">
        {/* The heading is the link to the full page — what lets the nav entry above go. */}
        <Link
          href="/library"
          onClick={exitTheater}
          className="press flex items-center gap-3 px-4 pb-3 pt-3.5 text-[var(--fg-dim)] hover:text-[var(--fg)]"
        >
          <LibraryIcon className="size-[18px] shrink-0" />
          <span className="text-sm font-bold">Your library</span>
          <span className="ml-auto text-xs font-semibold tabular-nums text-[var(--fg-faint)]">
            {(filter === "Queue" ? rows.length : (playlists?.length ?? 0)) || ""}
          </span>
        </Link>

        <div className="flex gap-1.5 px-3 pb-3">
          {FILTERS.map((name) => {
            const selected = filter === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setFilter(name)}
                className={`press rounded-[var(--r-full)] px-2.5 py-1 text-[11px] font-bold ${
                  selected
                    ? "slab-sm tint text-[var(--accent-fg)]"
                    : "bg-[var(--surface-2)] text-[var(--fg-dim)]"
                }`}
                style={selected ? { background: "var(--accent)" } : undefined}
              >
                {name}
              </button>
            );
          })}
        </div>

        {/* A plain cut at the edge — a mask over the last 20px dissolves the final row, which
            reads as the list running out rather than scrolling. */}
        <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filter === "Playlists" ? (
            <PlaylistRows playlists={playlists} settled={settled} />
          ) : rows.length === 0 ? (
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
                      <Artwork
                        src={song.artworkUrl}
                        className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
                        iconClassName="size-4"
                      />
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
      </div>

      {/* This rail is `lg:flex`, so the library page carries the same links for phones. */}
      <SiteLinks className="px-2 pt-0.5" />
    </aside>
  );
}

/** Saved playlists in the rail. */
function PlaylistRows({
  playlists,
  settled,
}: {
  playlists: PlaylistSummary[] | null;
  /** False until storage has been read — see the store. */
  settled: boolean;
}) {
  // The only thing to wait for is the first read of storage, which cannot happen in render.
  if (!settled || playlists === null) {
    return <p className="px-2 py-6 text-xs text-[var(--fg-faint)]">Loading…</p>;
  }

  if (playlists.length === 0) {
    return (
      <p className="px-2 py-6 text-xs leading-relaxed text-[var(--fg-faint)]">
        No playlists yet. Save a song with the + on any result.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {playlists.map((playlist) => (
        <li key={playlist.id}>
          <Link
            href={`/playlist/${playlist.id}`}
            className="flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 text-left hover:bg-[var(--surface-2)]"
          >
            <PlaylistCover
              covers={playlist.covers}
              className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
              iconClassName="size-4"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{playlist.name}</span>
              <span className="block truncate text-[11px] text-[var(--fg-dim)]">
                {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Mobile navigation. Sits below the mini player so the two stack into one
 * thumb-reachable block. */
export function BottomNav() {
  const pathname = usePathname();
  const { exitTheater } = usePlayerControls();

  return (
    <nav className="flex h-[var(--nav-h)] shrink-0 items-stretch border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] lg:hidden">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={exitTheater}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
              active ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)]"
            }`}
          >
            <item.icon className="size-[22px]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The way into your profile on a phone — not a fourth tab, but it has to exist somewhere:
 * the rail carrying the desktop link is `lg:flex`, so without this `/profile` and the theme
 * picker on it are unreachable below that width. */
export function ProfileButton({ className }: { className?: string }) {
  const { exitTheater } = usePlayerControls();
  const profile = useLocalProfile();
  const pictures = useLocalImages();

  return (
    <Link
      href="/profile"
      onClick={exitTheater}
      aria-label="Your profile and settings"
      className={`press flex shrink-0 items-center lg:hidden ${className ?? ""}`}
    >
      {/* As in the rail, drawn from CSS until React can read storage. The wrapper keeps the
          box either way, so the search field beside it never resizes. */}
      <span className="block size-9">
        <Avatar
          id={profile.id}
          name={profile.name}
          email={profile.name ?? "Profile"}
          image={pictures.avatar}
          className="slab-sm size-9"
          textClassName="text-xs"
        />
      </span>
    </Link>
  );
}
