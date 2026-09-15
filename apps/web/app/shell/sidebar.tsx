"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Artwork } from "../artwork";
import { Equalizer } from "../equalizer";
import { moveBetweenItems } from "../a11y/arrow-nav";
import { CloseIcon, CompassIcon, HomeIcon, LibraryIcon } from "../icons";
import { createJsonStore, useLocalStore } from "../local-store.ts";
import { usePlayerControls } from "../player/player-context";
import { LikedCover, LikedRow } from "../playlists/liked-tile";
import { PlaylistCover } from "../playlists/playlist-cover";
import { usePlaylistImages } from "../playlists/playlist-image";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
import { Avatar } from "../profile/avatar";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { TimbreMark } from "./brand";

const NAV = [
  { label: "Home", icon: HomeIcon, href: "/" },
  { label: "Explore", icon: CompassIcon, href: "/explore" },
  { label: "Library", icon: LibraryIcon, href: "/library" },
];

const FILTERS = ["Queue", "Playlists"] as const;

type Filter = (typeof FILTERS)[number];

// Whether the rail is shrunk to icons is a decision you make once, so it outlives the tab —
// same `timbre:` prefix and the same JSON store every other preference here uses, which also
// means the crash screen's export carries it out with the rest.
const railStore = createJsonStore("timbre:rail-collapsed", true, (stored) => stored !== false);

export function useRailCollapsed(): boolean {
  return useLocalStore(railStore);
}

export function toggleRail(): void {
  railStore.save(!railStore.getSnapshot());
}

/** One rail, three dresses. `label` is the words, `wide` is anything that only makes sense
 * beside words, `narrow` is anything that replaces them, and `row` re-centres what is left.
 * Width picks between AUTO and ICONS in CSS rather than in JS, so a wide screen paints the
 * labelled rail on the server's first pass instead of flicking into it after hydration. */
type RailStyle = {
  label: string;
  wide: string;
  narrow: string;
  row: string;
  pad: string;
};

const LABELLED: RailStyle = {
  label: "",
  wide: "flex",
  narrow: "hidden",
  row: "justify-start",
  pad: "px-3",
};

const AUTO: RailStyle = {
  label: "hidden xl:inline",
  wide: "hidden xl:flex",
  narrow: "flex xl:hidden",
  row: "justify-center xl:justify-start",
  pad: "px-1 xl:px-3",
};

const ICONS: RailStyle = {
  label: "hidden",
  wide: "hidden",
  narrow: "flex",
  row: "justify-center",
  pad: "px-1",
};

/** A panel with its first column ruled off — the rail, shown opening or closing. */
function ExpandRailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m14.5 9.5 2.5 2.5-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavLinks({ rail }: { rail?: RailStyle }) {
  const pathname = usePathname();
  const { exitTheater } = usePlayerControls();

  const items = rail ? NAV.filter((item) => item.href !== "/library") : NAV;
  return items.map(({ label, icon: Icon, href }) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={exitTheater}
        aria-current={active ? "page" : undefined}
        title={rail ? label : undefined}
        className={
          rail
            ? `press flex items-center gap-3.5 rounded-[var(--r-md)] py-2.5 text-sm font-semibold ${rail.row} ${rail.pad} ${
                active
                  ? "text-[var(--fg)]"
                  : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              }`
            : `flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                active ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)]"
              }`
        }
        style={rail && active ? { background: "var(--accent-wash)" } : undefined}
      >
        <Icon
          className={
            rail
              ? `size-[18px] shrink-0 ${active ? "tint text-[var(--accent)]" : ""}`
              : "size-[22px]"
          }
        />
        <span className={rail ? rail.label : undefined}>{label}</span>
      </Link>
    );
  });
}

export function Sidebar() {
  const { exitTheater } = usePlayerControls();
  const collapsed = useRailCollapsed();
  const [filter, setFilter] = useState<Filter>("Queue");
  const [drawer, setDrawer] = useState(false);

  // Icons by default — the labelled rail spent 16.75rem repeating five words the icons already
  // say. But it expands, and the control for that lives in the rail rather than in the top bar,
  // which is the only place it makes sense: it is the thing it acts on.
  const style = collapsed ? ICONS : LABELLED;

  useEffect(() => {
    void loadPlaylists();
  }, []);

  return (
    <>
      <aside
        className={`hidden shrink-0 flex-col p-2 pb-1.5 lg:flex ${collapsed ? "w-[4.5rem]" : "w-[15rem]"}`}
      >
        {/* One rail, one edge. The brand, the nav and the library used to be three separate
            bordered cards stacked with a gap, which at icon width read as a column of unrelated
            boxes rather than a sidebar. They are sections inside a single surface now, separated
            by a rule instead of by air. */}
        <div className="slab flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] p-1.5">
          <Link
            href="/"
            onClick={exitTheater}
            aria-label="Timbre — home"
            className={`press flex h-10 items-center gap-2.5 rounded-[var(--r-md)] ${style.row} ${style.pad}`}
          >
            <TimbreMark aria-hidden className="h-[22px] w-auto shrink-0 text-[var(--accent)]" />
            <span className={`text-[17px] font-extrabold tracking-tight ${style.label}`}>
              Timbre
            </span>
          </Link>

          <nav aria-label="Primary" className="flex flex-col gap-0.5">
            <NavLinks rail={style} />
          </nav>

          <hr className="my-1.5 border-0 border-t border-[var(--line)]" />

          <LibraryCard
            style={style}
            filter={filter}
            onFilter={setFilter}
            onExpand={() => setDrawer(true)}
          />

          <button
            type="button"
            onClick={toggleRail}
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            aria-pressed={!collapsed}
            title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            className={`press mt-auto flex h-9 shrink-0 items-center gap-3 rounded-[var(--r-md)] text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] ${style.row} ${style.pad}`}
          >
            <ExpandRailIcon
              className={`size-[18px] shrink-0 transition-transform ${collapsed ? "" : "rotate-180"}`}
            />
            <span className={`text-sm font-semibold ${style.label}`}>Collapse</span>
          </button>
        </div>
      </aside>

      <LibraryDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        filter={filter}
        onFilter={setFilter}
      />
    </>
  );
}

function LibraryCard({
  style,
  filter,
  onFilter,
  onExpand,
  onNavigate,
}: {
  style: RailStyle;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  onExpand?: () => void;
  onNavigate?: () => void;
}) {
  const { queue, current, play, exitTheater } = usePlayerControls();
  const { playlists, settled } = usePlaylists();
  const [list, edges] = useScrollEdges();

  const count = (filter === "Queue" ? queue.length : (playlists?.length ?? 0)) || "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Link
        href="/library"
        onClick={() => {
          exitTheater();
          onNavigate?.();
        }}
        className={`press ${style.wide} items-center gap-3 px-3.5 pb-2.5 pt-3 text-[var(--fg-dim)] hover:text-[var(--fg)]`}
      >
        <LibraryIcon className="size-[18px] shrink-0" />
        <span className="text-sm font-bold">Your library</span>
        <span className="ml-auto text-xs font-semibold tabular-nums text-[var(--fg-faint)]">
          {count}
        </span>
      </Link>

      {/* Icon width has no room for the filters or a scrolling list, so it goes to the library
          page. It used to open a drawer over the top layer, which meant clicking your library
          from a playlist floated a translucent panel across the page you were reading instead of
          taking you anywhere. A library is a place; navigate to it. */}
      <Link
        href="/library"
        onClick={() => {
          exitTheater();
          onNavigate?.();
        }}
        aria-label="Your library"
        title="Your library"
        className={`press ${style.narrow} shrink-0 items-center justify-center px-2 pb-2.5 pt-3 text-[var(--fg-dim)] hover:text-[var(--fg)]`}
      >
        <LibraryIcon className="size-[18px] shrink-0" />
      </Link>

      <div className={`${style.wide} gap-1.5 px-3 pb-2.5`} role="group" aria-label="Library filter">
        {FILTERS.map((name) => {
          const selected = filter === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onFilter(name)}
              aria-pressed={selected}
              className={`press rounded-[var(--r-full)] px-2.5 py-1 text-[11px] font-bold ${
                selected
                  ? "slab-sm tint text-[var(--accent-fg)]"
                  : "slab-ghost bg-[var(--surface-2)] text-[var(--fg-dim)]"
              }`}
              style={selected ? { background: "var(--accent)" } : undefined}
            >
              {name}
            </button>
          );
        })}
      </div>

      <div
        ref={list}
        data-above={edges.above || undefined}
        data-below={edges.below || undefined}
        className="edge-fade scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {filter === "Playlists" ? (
          <>
            <div className={`${style.wide} flex-col`}>
              <LikedRow />
            </div>
            <Link
              href="/liked"
              onClick={onNavigate}
              title="Liked songs"
              className={`${style.narrow} mb-0.5 w-full items-center justify-center rounded-[var(--r-md)] p-1.5 hover:bg-[var(--surface-2)]`}
            >
              <LikedCover
                className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
                iconClassName="size-4"
              />
            </Link>
            <PlaylistRows
              playlists={playlists}
              settled={settled}
              style={style}
              onNavigate={onNavigate}
            />
          </>
        ) : queue.length === 0 ? (
          <p className={`${style.wide} px-2 py-6 text-xs leading-relaxed text-[var(--fg-faint)]`}>
            Nothing queued. Play something and it shows up here.
          </p>
        ) : (
          <ul
            className="flex flex-col gap-0.5"
            onKeyDown={(event) => moveBetweenItems(event, event.currentTarget, "vertical")}
          >
            {queue.map((song) => {
              const isCurrent = current?.id === song.id;
              return (
                <li key={song.id}>
                  <button
                    type="button"
                    onClick={() => {
                      play(song, queue);
                      onNavigate?.();
                    }}
                    title={song.title}
                    className={`flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 text-left ${style.row} ${
                      isCurrent ? "tint" : "hover:bg-[var(--surface-2)]"
                    }`}
                    style={isCurrent ? { background: "var(--accent-wash)" } : undefined}
                  >
                    <Artwork
                      src={song.artworkUrl}
                      className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
                      iconClassName="size-4"
                    />
                    <span className={`min-w-0 flex-1 ${style.label}`}>
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
  );
}

// A `<dialog>` rather than a fixed panel of our own: the top layer is outside every containing
// block on the page, so none of the `@container` page wrappers can capture it the way they
// capture a `position: fixed` child, and Escape and the focus trap come for free.
function LibraryDrawer({
  open,
  onClose,
  filter,
  onFilter,
}: {
  open: boolean;
  onClose: () => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label="Your library"
      onClose={onClose}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none items-stretch justify-start overflow-hidden bg-transparent p-0 text-[var(--fg)] backdrop:bg-[rgb(0_0_0/50%)] backdrop:backdrop-blur-[6px] open:flex"
    >
      {open && (
        <div className="rise flex h-full w-[19rem] max-w-[86vw] flex-col gap-1.5 p-2 pl-[calc(0.5rem+var(--safe-l))]">
          <div className="flex h-10 shrink-0 items-center gap-2 px-1.5">
            <span className="text-[15px] font-extrabold tracking-tight">Your library</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close library"
              className="press ml-auto flex size-8 items-center justify-center rounded-[var(--r-md)] text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
          <LibraryCard
            style={LABELLED}
            filter={filter}
            onFilter={onFilter}
            onNavigate={onClose}
          />
        </div>
      )}
    </dialog>
  );
}

// Whether a scroll box has more above or below what it shows, so `.edge-fade` softens only an
// edge with something past it. Watched, not measured once: the queue grows, and switching tabs
// swaps the box's contents without resizing the box.
function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const above = el.scrollTop > 1;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
    };
    watch();
    const contents = new MutationObserver(watch);
    contents.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
      contents.disconnect();
    };
  }, []);

  return [ref, edges] as const;
}

function PlaylistRows({
  playlists,
  settled,
  style,
  onNavigate,
}: {
  playlists: PlaylistSummary[] | null;
  settled: boolean;
  style: RailStyle;
  onNavigate?: () => void;
}) {
  const { queueOrigin, state } = usePlayerControls();
  const uploaded = usePlaylistImages();
  if (!settled || playlists === null) {
    return <p className={`${style.wide} px-2 py-6 text-xs text-[var(--fg-faint)]`}>Loading…</p>;
  }

  if (playlists.length === 0) {
    return (
      <p className={`${style.wide} px-2 py-6 text-xs leading-relaxed text-[var(--fg-faint)]`}>
        No playlists yet. Save a song with the + on any result.
      </p>
    );
  }

  return (
    <ul
      className="flex flex-col gap-0.5"
      onKeyDown={(event) => moveBetweenItems(event, event.currentTarget, "vertical")}
    >
      {playlists.map((playlist) => {
        const playing =
          queueOrigin?.kind === "playlist" && queueOrigin.id === playlist.id && state === "playing";

        return (
          <li key={playlist.id}>
            <Link
              href={`/playlist/${playlist.id}`}
              onClick={onNavigate}
              title={playlist.name}
              className={`flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 text-left ${style.row} ${
                playing ? "tint" : "hover:bg-[var(--surface-2)]"
              }`}
              style={playing ? { background: "var(--accent-wash)" } : undefined}
            >
              <PlaylistCover
                covers={playlist.covers}
                coverUrl={playlist.coverUrl}
                uploaded={uploaded[playlist.id]}
                className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
                iconClassName="size-4"
              />
              <span className={`min-w-0 flex-1 ${style.label}`}>
                <span
                  className={`flex items-center gap-1.5 text-[13px] font-semibold ${
                    playing ? "text-[var(--accent)]" : ""
                  }`}
                >
                  <span className="truncate">{playlist.name}</span>
                  {playing && <Equalizer className="tint h-3 shrink-0 gap-0.5" />}
                </span>
                <span className="block truncate text-[11px] text-[var(--fg-dim)]">
                  {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
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
      className={`press flex shrink-0 items-center ${className ?? ""}`}
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
