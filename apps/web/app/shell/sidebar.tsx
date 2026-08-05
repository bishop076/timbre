"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Artwork } from "../artwork";
import { HomeIcon, LibraryIcon, SearchIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { PlaylistCover } from "../playlists/playlist-cover";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
import { Avatar } from "../profile/avatar";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { SiteLinks } from "./site-links";

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

/*
 * Home, Search, Library — the three tabs every music app has settled on.
 *
 * `/` used to be both home and search, with the field pinned above the shelves.
 * Splitting them is what lets Home open with something to play rather than with
 * a question, and it puts Search where a thumb expects to find it.
 */
const NAV = [
  { id: "home", label: "Home", icon: HomeIcon, href: "/" },
  { id: "search", label: "Search", icon: SearchIcon, href: "/search" },
  { id: "library", label: "Library", icon: LibraryIcon, href: "/library" },
];

// "Artists" is absent rather than disabled. Timbre has artist *pages*, reached
// from any song, but nothing follows an artist — so a chip here would promise a
// collection that does not exist.
const FILTERS = ["Queue", "Playlists"] as const;

export function Sidebar() {
  const { queue, current, play, exitTheater } = usePlayer();
  const profile = useLocalProfile();
  const pictures = useLocalImages();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Queue");
  const { playlists, settled } = usePlaylists();
  const pathname = usePathname();

  // Loaded once for the rail, and shared with every "add to playlist" menu, so
  // switching to the Playlists chip is instant rather than a fetch.
  useEffect(() => {
    void loadPlaylists();
  }, []);

  const rows = filter === "Queue" ? queue : [];

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 p-2 lg:flex">
      {/*
        Whose app this is.

        There is no account, so this is not a session indicator — it is the way
        into your own profile, wearing whatever name and picture you set on this
        device. A blank one is the ordinary first-run state rather than a
        signed-out state, so it links either way.
      */}
      <Link
        href="/profile"
        onClick={exitTheater}
        className="press relative mb-1 flex items-center gap-2.5 overflow-hidden rounded-[var(--r-lg)] px-3 py-3 hover:bg-[var(--surface-1)]"
      >
        <Avatar
          id={profile.id || "local"}
          name={profile.name}
          email={profile.name ?? "Profile"}
          image={pictures.avatar}
          className="size-8 shrink-0"
          textClassName="text-sm"
        />
        <span className="truncate text-[17px] font-extrabold tracking-tight">
          {profile.name?.trim() || "Profile"}
        </span>
      </Link>

      <nav className="slab flex flex-col gap-1 rounded-[var(--r-lg)] bg-[var(--surface-1)] p-2">
        {NAV.map((item) => {
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
        <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
          <LibraryIcon className="size-[18px] shrink-0 text-[var(--fg-dim)]" />
          <span className="text-sm font-bold text-[var(--fg-dim)]">Your library</span>
          <span className="ml-auto text-xs font-semibold tabular-nums text-[var(--fg-faint)]">
            {(filter === "Queue" ? rows.length : (playlists?.length ?? 0)) || ""}
          </span>
        </div>

        {/* Filter chips, Spotify's affordance for slicing the library. */}
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

      {/* This rail is `lg:flex`, so it cannot be the only route to these — the
          library page carries the same links for phones. See `site-links.tsx`. */}
      <SiteLinks className="px-2 pt-0.5" />
    </aside>
  );
}

/**
 * Saved playlists in the rail.
 *
 * Signed out, this is an invitation rather than an empty list — "you have none"
 * and "you cannot have any yet" look identical otherwise, and only one of them
 * is worth showing a create button for.
 */
function PlaylistRows({
  playlists,
  settled,
}: {
  playlists: PlaylistSummary[] | null;
  /** False until storage has been read — see the store. */
  settled: boolean;
}) {
  // Playlists need no account: they live in this browser. What is left to wait
  // for is only the first read of storage, which cannot happen during render.
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

/**
 * Mobile navigation.
 *
 * Sits below the mini player so the two stack into one thumb-reachable block at
 * the bottom of the screen, which is where phone music apps put them.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { exitTheater } = usePlayer();

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

/**
 * The way into your profile on a phone.
 *
 * Not a fourth tab. The bottom bar is for *places you go to listen*, and a
 * settings screen sitting alongside them competes for a thumb position it does
 * not deserve — which is why phone music apps put it in the corner of the home
 * header instead. Rendered by the home and search screens.
 *
 * It has to exist somewhere, though: the rail carrying the desktop profile link
 * is `lg:flex`, so without this `/profile` — and the theme picker on it — is
 * unreachable below that width.
 */
export function ProfileButton({ className }: { className?: string }) {
  const { exitTheater } = usePlayer();
  const profile = useLocalProfile();
  const pictures = useLocalImages();

  return (
    <Link
      href="/profile"
      onClick={exitTheater}
      aria-label="Your profile and settings"
      className={`press flex shrink-0 items-center lg:hidden ${className ?? ""}`}
    >
      <Avatar
        id={profile.id || "local"}
        name={profile.name}
        email={profile.name ?? "Profile"}
        image={pictures.avatar}
        className="slab-sm size-9"
        textClassName="text-xs"
      />
    </Link>
  );
}

