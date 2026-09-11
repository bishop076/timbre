"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Artwork } from "../artwork";
import { useHydrated } from "../hydrated";
import { CompassIcon, HomeIcon, LibraryIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { LikedRow } from "../playlists/liked-tile";
import { PlaylistCover } from "../playlists/playlist-cover";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
import { Avatar } from "../profile/avatar";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { TimbreMark } from "./brand";
import { SiteLinks } from "./site-links";

const NAV = [
  { label: "Home", icon: HomeIcon, href: "/" },
  { label: "Explore", icon: CompassIcon, href: "/explore" },
  { label: "Library", icon: LibraryIcon, href: "/library" },
];

const FILTERS = ["Queue", "Playlists"] as const;

function NavLinks({ sidebar = false }: { sidebar?: boolean }) {
  const pathname = usePathname();
  const { exitTheater } = usePlayerControls();

  const items = sidebar ? NAV.filter((item) => item.href !== "/library") : NAV;
  return items.map(({ label, icon: Icon, href }) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={exitTheater}
        aria-current={active ? "page" : undefined}
        className={
          sidebar
            ? `press flex items-center gap-3.5 rounded-[var(--r-md)] px-3 py-2.5 text-sm font-semibold ${
                active
                  ? "slab-sm tint text-[var(--accent-fg)]"
                  : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              }`
            : `flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                active ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)]"
              }`
        }
        style={sidebar && active ? { background: "var(--accent)" } : undefined}
      >
        <Icon className={sidebar ? "size-[18px] shrink-0" : "size-[22px]"} />
        {label}
      </Link>
    );
  });
}

export function Sidebar() {
  const { queue, current, play, exitTheater } = usePlayerControls();
  const profile = useLocalProfile();
  const pictures = useLocalImages();
  const hydrated = useHydrated();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Queue");
  const { playlists, settled } = usePlaylists();

  useEffect(() => {
    void loadPlaylists();
  }, []);

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-1.5 p-2 pb-1.5 lg:flex">
      <div className="mb-0.5 flex items-center gap-1.5 pl-3">
        <TimbreMark
          role="img"
          aria-label="Timbre"
          className="h-6 w-auto shrink-0 text-[var(--accent)]"
        />
        <Link
          href="/profile"
          onClick={exitTheater}
          className="press relative flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-[var(--r-lg)] px-2 py-2.5 hover:bg-[var(--surface-1)]"
        >
          <Avatar
            id={profile.id}
            name={profile.name}
            email={profile.name ?? "Profile"}
            image={pictures.avatar}
            className="size-8 shrink-0"
            textClassName="text-sm"
          />
          <span
            className="replay truncate text-[17px] font-extrabold tracking-tight"
            style={{ "--replay": 'var(--profile-name, "Profile")' } as React.CSSProperties}
          >
            {hydrated ? profile.name?.trim() || "Profile" : null}
          </span>
        </Link>
      </div>

      <nav className="slab flex flex-col gap-1 rounded-[var(--r-lg)] bg-[var(--surface-1)] p-2">
        <NavLinks sidebar />
      </nav>

      <div className="slab flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)]">
        <Link
          href="/library"
          onClick={exitTheater}
          className="press flex items-center gap-3 px-4 pb-3 pt-3.5 text-[var(--fg-dim)] hover:text-[var(--fg)]"
        >
          <LibraryIcon className="size-[18px] shrink-0" />
          <span className="text-sm font-bold">Your library</span>
          <span className="ml-auto text-xs font-semibold tabular-nums text-[var(--fg-faint)]">
            {(filter === "Queue" ? queue.length : (playlists?.length ?? 0)) || ""}
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

        <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filter === "Playlists" ? (
            <>
              <LikedRow />
              <PlaylistRows playlists={playlists} settled={settled} />
            </>
          ) : queue.length === 0 ? (
            <p className="px-2 py-6 text-xs leading-relaxed text-[var(--fg-faint)]">
              Nothing queued. Play something and it shows up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {queue.map((song) => {
                const isCurrent = current?.id === song.id;
                return (
                  <li key={song.id}>
                    <button
                      type="button"
                      onClick={() => play(song, queue)}
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

      <SiteLinks className="px-2 pt-0.5" />
    </aside>
  );
}

function PlaylistRows({
  playlists,
  settled,
}: {
  playlists: PlaylistSummary[] | null;
  settled: boolean;
}) {
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

export function BottomNav() {
  return (
    <nav className="flex h-[calc(var(--nav-h)+var(--safe-b))] shrink-0 items-stretch border-t-[length:var(--edge)] border-[var(--ink)] bg-[var(--surface-1)] pb-[var(--safe-b)] lg:hidden">
      <NavLinks />
    </nav>
  );
}

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
