"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Artwork } from "../artwork";
import { Equalizer } from "../equalizer";
import { moveBetweenItems } from "../a11y/arrow-nav";
import { useScrollEdges } from "../scroll-edges";
import { CloseIcon, CompassIcon, HomeIcon, LibraryIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { LikedCover, LikedRow } from "../playlists/liked-tile";
import { PlaylistCover } from "../playlists/playlist-cover";
import { usePlaylistImages } from "../playlists/playlist-image";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
import { Avatar } from "../profile/avatar";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { TimbreMark, TimbreWordmark } from "./brand";
import {
  dockedPanelWidth,
  RAIL_ICONS,
  RAIL_MAX,
  RAIL_WIDE,
  resolveRailWidth,
  roomFor,
  saveRailWidth,
  usePanelWidth,
  useRailWidth,
} from "./pane-size.ts";
import { ResizeHandle, useViewportWidth } from "./resize-handle";

const NAV = [
  { label: "Home", icon: HomeIcon, href: "/" },
  { label: "Explore", icon: CompassIcon, href: "/explore" },
  { label: "Library", icon: LibraryIcon, href: "/library" },
];

const FILTERS = ["Queue", "Playlists"] as const;

type Filter = (typeof FILTERS)[number];

/** The id the rail's drag handle points `aria-controls` at, and how that handle finds the rail
 *  to write its width onto mid-drag. */
const RAIL_ID = "app-rail";

/** One rail, two dresses. `label` is the words, `wide` is anything that only makes sense beside
 * words, `narrow` is anything that replaces them, and `row` re-centres what is left.
 *
 * The switch is a container query on the rail itself, not a viewport media query and not a
 * branch in JS. That matters twice over. The rail's width is now a dragged number, so no media
 * query could describe it; and the words appear at exactly the width the snap guarantees, in the
 * same paint that changes the width, rather than one React render later.
 *
 * 9rem is the rail's *content* box — the aside's `p-2` is outside it — so it sits in the dead
 * band the snap keeps empty: the icon rail's content is 56px and the narrowest labelled rail's
 * is 192px. There is no width at which half a label is on screen. */
type RailStyle = {
  label: string;
  wide: string;
  narrow: string;
  row: string;
  pad: string;
};

const RAIL: RailStyle = {
  label: "hidden @[9rem]:inline",
  wide: "hidden @[9rem]:flex",
  narrow: "flex @[9rem]:hidden",
  row: "justify-center @[9rem]:justify-start",
  pad: "px-1 @[9rem]:px-3",
};

const LABELLED: RailStyle = {
  label: "",
  wide: "flex",
  narrow: "hidden",
  row: "justify-start",
  pad: "px-3",
};

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
  const { exitTheater, current, panelOpen } = usePlayerControls();
  const width = useRailWidth();
  const panel = usePanelWidth();
  const viewport = useViewportWidth();
  const [filter, setFilter] = useState<Filter>("Queue");
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    void loadPlaylists();
  }, []);

  // Icons by default — the labelled rail spent 16.75rem repeating five words the icons already
  // say. It grows by dragging its right edge now; the button that used to do it is gone, along
  // with the row of chrome it cost at the foot of a 690px window.
  //
  // How far it may grow depends on what the now-playing panel is taking on the other side, which
  // is only anything at all once the panel is docked rather than floating.
  const ceiling = roomFor(
    viewport,
    dockedPanelWidth(panel, current !== null && panelOpen, viewport),
    { max: RAIL_MAX, floor: RAIL_ICONS },
  );
  const resolve = (raw: number) => resolveRailWidth(raw, ceiling);

  return (
    <>
      <aside
        // Two <aside> elements are two "complementary" landmarks, and an unnamed one is
        // announced as just "complementary". The now-playing panel names itself; this one has
        // to as well or a reader cannot tell the two apart in a landmark list.
        aria-label="Sidebar"
        id={RAIL_ID}
        // `@container` here is what lets the labels follow the dragged width. It also makes this
        // element the containing block for any `position: fixed` inside it — the trap the page
        // wrappers already set — which is safe only because nothing in the rail is fixed. The
        // library drawer below is a `<dialog>` in the top layer, and it is not in here anyway.
        style={{ "--rail-w": `${width}px` } as React.CSSProperties}
        // `p-2` all round, not `p-2 pb-1.5`. The main column and the now-playing panel both
        // stop 8px short of the row, so a 6px bottom left this card's edge two pixels lower
        // than the two it sits beside — three cards in a row, two lined up and one not.
        className="@container relative hidden w-[var(--rail-w,4.5rem)] shrink-0 flex-col p-2 lg:flex"
      >
        {/* One rail, one edge. The brand, the nav and the library used to be three separate
            bordered cards stacked with a gap, which at icon width read as a column of unrelated
            boxes rather than a sidebar. They are sections inside a single surface now, separated
            by a rule instead of by air. */}
        <div className="slab flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden rounded-[var(--r-lg)] bg-[var(--shell-1)] p-1.5">
          <Link
            href="/"
            onClick={exitTheater}
            aria-label="Timbre — home"
            className={`press flex h-12 items-center gap-2.5 rounded-[var(--r-md)] ${RAIL.row} ${RAIL.pad}`}
          >
            <TimbreMark aria-hidden className="h-7 w-auto shrink-0 text-[var(--accent)]" />
            {/* The real wordmark, not the word set in the UI font. The mark is two faces — "tim"
                in Delicious Handrawn, "bre" in Gluten — and none of that survives being typed in
                Geist. */}
            <TimbreWordmark className="hidden h-6 w-auto shrink-0 @[9rem]:block" />
          </Link>

          <nav aria-label="Primary" className="flex flex-col gap-0.5">
            <NavLinks rail={RAIL} />
          </nav>

          <hr className="my-1.5 border-0 border-t border-[var(--line)]" />

          <LibraryCard
            style={RAIL}
            filter={filter}
            onFilter={setFilter}
            onExpand={() => setDrawer(true)}
          />
        </div>

        {/* Pinned over the rail's own right-hand padding, so the gutter between the rail and the
            page is the grab area and the layout gains nothing. */}
        <ResizeHandle
          controls={RAIL_ID}
          label="Resize the sidebar"
          variable="--rail-w"
          width={width}
          min={RAIL_ICONS}
          max={ceiling}
          reset={RAIL_WIDE}
          direction={1}
          resolve={resolve}
          onCommit={saveRailWidth}
          className="bottom-2 right-0 top-2"
        />
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
        // `.focus-ring-inset`, for the same reason a tile's cover art uses it. This link is a
        // flex child of the `overflow: hidden` box above with no padding between them, so it is
        // flush left, right and top — and the ordinary ring is drawn *outside* the border box,
        // which means three of its four sides were clipped away. What a keyboard reader saw
        // when they reached their library was a white bar under the icon, not a ring.
        className={`focus-ring-inset press ${style.wide} items-center gap-3 rounded-[var(--r-md)] px-3.5 pb-2.5 pt-3 text-[var(--fg-dim)] hover:text-[var(--fg)]`}
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
        className={`focus-ring-inset press ${style.narrow} shrink-0 items-center justify-center rounded-[var(--r-md)] px-2 pb-2.5 pt-3 text-[var(--fg-dim)] hover:text-[var(--fg)]`}
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
