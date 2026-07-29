"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { LibraryIcon, NoteIcon, SearchIcon } from "../icons";
import { usePlayer } from "../player/player-context";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
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
  { id: "search", label: "Search", icon: SearchIcon, href: "/" },
  { id: "library", label: "Library", icon: LibraryIcon, href: "/library" },
];

/**
 * Sources that can actually play audio. **Only these are listed.**
 *
 * This used to list all three searchable sources under a line about playback,
 * which reads as a promise that all three play. They do not: Deezer and Apple
 * both need a paid subscription for full audio, and Apple additionally needs a
 * paid developer membership to sign a token, so neither can ever be a play
 * source under Timbre's no-paying rule.
 *
 * They still contribute identity, artwork and charts — Deezer's ISRCs are what
 * make cross-source matching reliable at all — but a legend in the shell is
 * read as "here is what you can hear", so contributing behind the scenes does
 * not earn a dot. Where a link-out genuinely exists it is offered in place, on
 * the search row itself, labelled "Open on …" rather than implied here.
 *
 * SoundCloud belongs in this list the day its search is unblocked: its player
 * is free and already built. See docs/BLOCKED.md.
 */
const PLAYS = ["ytmusic"] as const;

// "Artists" is absent rather than disabled. Timbre has artist *pages*, reached
// from any song, but nothing follows an artist — so a chip here would promise a
// collection that does not exist.
const FILTERS = ["Queue", "Playlists"] as const;

export function Sidebar() {
  const { queue, current, play } = usePlayer();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Queue");
  const { playlists, signedIn } = usePlaylists();
  const pathname = usePathname();

  // Loaded once for the rail, and shared with every "add to playlist" menu, so
  // switching to the Playlists chip is instant rather than a fetch.
  useEffect(() => {
    void loadPlaylists();
  }, []);

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
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
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
            <PlaylistRows playlists={playlists} signedIn={signedIn} />
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
          {PLAYS.map((id) => (
            <span key={id} className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)]">
              <span
                className="size-2 shrink-0 rounded-full border border-[var(--ink)]"
                style={{ backgroundColor: sourceStyle(id).color }}
              />
              {sourceStyle(id).short}
            </span>
          ))}
          <p className="w-full text-[10px] leading-relaxed text-[var(--fg-faint)]">
            Timbre hosts nothing. Audio plays from YouTube Music&rsquo;s own player.
          </p>
        </div>
      </div>
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
  signedIn,
}: {
  playlists: PlaylistSummary[] | null;
  signedIn: boolean;
}) {
  if (!signedIn) {
    return (
      <div className="px-2 py-5">
        <p className="text-xs leading-relaxed text-[var(--fg-faint)]">
          Sign in to keep playlists. Listening never needs an account.
        </p>
        <Link
          href="/signin?callbackUrl=/library"
          className="slab-sm press mt-2.5 inline-block rounded-[var(--r-sm)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--accent-fg)]"
          style={{ background: "var(--accent)" }}
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (playlists === null) {
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
            <span className="slab-sm size-10 shrink-0 overflow-hidden rounded-[var(--r-sm)] bg-[var(--surface-2)]">
              {playlist.covers[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                <img
                  src={playlist.covers[0]}
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

  return (
    <nav className="flex h-[var(--nav-h)] shrink-0 items-stretch border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] lg:hidden">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.id}
            href={item.href}
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
