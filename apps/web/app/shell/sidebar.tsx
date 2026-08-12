"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Artwork } from "../artwork";
import { useHydrated } from "../hydrated";
import { CompassIcon, HomeIcon, LibraryIcon } from "../icons";
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
 * Home, Explore, Library.
 *
 * **Search is not a tab any more.** The field moved into the shell, so it is on
 * every page already and a nav entry leading to it would be a button that takes
 * you to a box you are currently looking at. What the third tab was actually
 * for — somewhere to go when you do not know what to type — is now its own
 * thing: charts, genres and releases, under its own name.
 */
const NAV = [
  { id: "home", label: "Home", icon: HomeIcon, href: "/" },
  { id: "explore", label: "Explore", icon: CompassIcon, href: "/explore" },
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
  const hydrated = useHydrated();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Queue");
  const { playlists, settled } = usePlaylists();
  const pathname = usePathname();

  // Loaded once for the rail, and shared with every "add to playlist" menu, so
  // switching to the Playlists chip is instant rather than a fetch.
  useEffect(() => {
    void loadPlaylists();
  }, []);

  const rows = filter === "Queue" ? queue : [];

  /*
   * A few pixels trimmed above, so the library panel gets them.
   *
   * The panel is `flex-1` — it cannot be made taller directly, only handed
   * space by what sits above it. The last row was landing half-cut against the
   * edge, which is the difference between a list that scrolls and one that
   * looks cramped, and that difference is about a dozen pixels. They come from
   * the gaps and the profile row's padding rather than from any one place, so
   * nothing above visibly shrinks.
   */
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-1.5 p-2 pb-1.5 lg:flex">
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
        className="press relative mb-0.5 flex items-center gap-2.5 overflow-hidden rounded-[var(--r-lg)] px-3 py-2.5 hover:bg-[var(--surface-1)]"
      >
        {/*
          Drawn on the first paint, not after hydration.

          This row used to render nothing at all until storage could be read,
          and the claim that it "keeps its height" was simply false: with no
          children it collapsed to its own padding, so **every load dropped the
          whole rail 32px down the page and then snapped it back**. That jump is
          the most visible thing about starting Timbre up.

          Both pieces can be correct this early without the server knowing
          anything. The avatar paints from `--avatar-thumb` / `--avatar-fill`,
          and the name from `--profile-name`, all three stamped onto `<html>` by
          the boot script in `layout.tsx` before the first pixel — see
          `profile/avatar.tsx` and the `.profile-name` rule in `globals.css`.
        */}
        <Avatar
          id={profile.id}
          name={profile.name}
          email={profile.name ?? "Profile"}
          image={pictures.avatar}
          className="size-8 shrink-0"
          textClassName="text-sm"
        />
        {/*
          Empty until hydration, and filled from CSS while it is — which is what
          keeps the wrong name off the screen without leaving a hole where the
          right one goes. `:empty` stops applying the moment React puts text in.
        */}
        <span
          className="replay truncate text-[17px] font-extrabold tracking-tight"
          style={{ "--replay": 'var(--profile-name, "Profile")' } as React.CSSProperties}
        >
          {hydrated ? profile.name?.trim() || "Profile" : null}
        </span>
      </Link>

      {/*
        Library is absent here, and the reasoning went in a circle worth
        recording so it does not go round again.

        The panel directly below *is* the library — same playlists, same
        destination — so a nav button above it labelled "Library" puts two
        controls with one name a centimetre apart. Spotify's rail omits it for
        exactly this reason: the rail is the library, and the panel's own
        heading is the way into the full page.

        It was briefly restored because the panel is `flex-1` and dropping a nav
        row hands that row's height to the list, which had grown twice over.
        That was solving the wrong problem: the extra height is a *longer list*,
        which is what was later asked for anyway. The duplicate label is the
        real defect, so the row goes and the height stays gained.

        <BottomNav> still shows it, because a phone has no rail to replace it.
      */}
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
        {/* The heading is the link to the full page, which is what lets the
            nav entry above go away without losing the route. */}
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

        {/*
          A plain cut at the edge — no fade, and no extra padding.

          Both were tried. Padding only moves where the cut lands; a mask over
          the last 20px dissolves the final row, which turned out to read as the
          list quietly running out rather than as a list that scrolls. A hard
          edge against the panel is what says "this continues", and it is what
          this rail did before either attempt.
        */}
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
      {/* As in the rail: drawn immediately, from CSS until React can read
          storage. The wrapper keeps the box either way, so the search field
          beside it never resizes. */}
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

