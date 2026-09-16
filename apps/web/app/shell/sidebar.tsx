"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Artwork } from "../artwork";
import { Equalizer } from "../equalizer";
import { moveBetweenItems } from "../a11y/arrow-nav";
import { useScrollEdges } from "../scroll-edges";
import { ChevronIcon, CompassIcon, HomeIcon, LibraryIcon } from "../icons";
import { usePlayerControls } from "../player/player-context";
import { LikedCover, LikedRow } from "../playlists/liked-tile";
import { PlaylistCover } from "../playlists/playlist-cover";
import { usePlaylistImages } from "../playlists/playlist-image";
import { loadPlaylists, usePlaylists, type PlaylistSummary } from "../playlists/store";
import { Avatar } from "../profile/avatar";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { TimbreMark } from "./brand";
import {
  dockedPanelWidth,
  RAIL_DOCK_MIN,
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

/** How much room the reveal zone gives the chevron to be found in, at labelled width.
 *
 * The button is 32px. A zone that is only the button is a control you have to already know
 * about — you cannot hover your way onto something invisible that is exactly its own size. A
 * zone that is the whole brand row is the other failure, and the one that was shipped: the
 * chevron lit up with the pointer on the palm mark 160px away, which reads as the rail
 * twitching rather than as a control answering you.
 *
 * 56px is the button plus 12px of approach on each side, in a 48px-tall row. It starts where
 * the mark's link ends and runs to the avatar, so the only way to cross it is to be moving
 * toward that corner of the rail — and it is comfortably past the 44px minimum for a target
 * anyone has to aim at.
 */
const TOGGLE_ZONE = "w-14";

/**
 * Collapse the rail to icons, or open it back out.
 *
 * The rail could only ever be *dragged* between its two widths, and the handle that does it is
 * 8px of gutter with no mark on it — so there was nothing to click, and nothing to say the two
 * states existed. This is that affordance.
 *
 * Hidden until you come near it, which is what was asked for: the rail is chrome, and a chevron
 * sitting on it permanently is one more thing in the corner of the eye on every page. It is
 * *not* hidden from anyone who cannot hover — `touch:` keeps it visible on a touchscreen and
 * `focus-visible` brings it back for the keyboard. That escape is the whole point of the
 * `touch:` variant: eleven controls in this app were hover-only and unreachable on a phone, and
 * adding a twelfth would have put one back the day the other eleven were fixed.
 *
 * `pointer-events-none` while invisible is load-bearing and stays: without it the button
 * swallows the click that goes home at icon width, where it sits over the mark. Which is also
 * why the reveal cannot be the button's own `:hover` — with pointer events off it never gets
 * one, and with them on it blocks the mark again. The trigger has to be something else, and
 * `className` is where the caller says what.
 *
 * Two callers, one at each width, because the answer differs. At labelled width the chevron has
 * a slot of its own between the mark and the avatar, and hovering that slot reveals it. At icon
 * width the row is 44px of content — there is no slot to give it, so it goes back to sitting
 * over the mark and the mark's row is the zone. At that size the row *is* "near it": the whole
 * thing is 44px across.
 */
function RailToggle({ wide, className }: { wide: boolean; className: string }) {
  return (
    <button
      type="button"
      onClick={() => saveRailWidth(wide ? RAIL_ICONS : RAIL_WIDE)}
      aria-label={wide ? "Collapse the sidebar to icons" : "Expand the sidebar"}
      aria-expanded={wide}
      aria-controls={RAIL_ID}
      title={wide ? "Collapse the sidebar" : "Expand the sidebar"}
      className={`press grid h-8 w-8 place-items-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg-dim)] pointer-events-none opacity-0 transition hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:pointer-events-auto focus-visible:opacity-100 touch:pointer-events-auto touch:opacity-100 ${className}`}
    >
      <ChevronIcon
        aria-hidden
        className={`h-4 w-4 ${wide ? "rotate-90" : "-rotate-90"}`}
      />
    </button>
  );
}

/**
 * What a rail row looks like when you are on the page it points at.
 *
 * One function rather than one class string per row, because there are three rows and they were
 * not agreeing. Home and Explore are `NavLinks`; the library is `LibraryCard`, a card rather
 * than a link because it carries the Queue/Playlists switch and the list under it — and
 * `/library` is filtered out of NAV in rail mode precisely so the card can render it. The cost
 * of that split was that the card's header row never reached the line that paints the wash, so
 * clicking your library lit nothing and announced nothing. It was not a missing class; it was a
 * row that had no way of reaching the class.
 *
 * `aria-current` is in here for the same reason the wash is. A reader who cannot see the tint
 * has only that attribute to tell them which of the three they are standing on, and two of the
 * three were setting it.
 */
function activeRow(active: boolean) {
  return {
    current: active ? ("page" as const) : undefined,
    row: active
      ? "text-[var(--fg)]"
      : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
    icon: active ? "tint text-[var(--accent)]" : "",
    wash: active ? { background: "var(--accent-wash)" } : undefined,
  };
}

function NavLinks({ rail }: { rail?: RailStyle }) {
  const pathname = usePathname();
  const { exitTheater } = usePlayerControls();

  const items = rail ? NAV.filter((item) => item.href !== "/library") : NAV;
  return items.map(({ label, icon: Icon, href }) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    const on = activeRow(active);
    return (
      <Link
        key={href}
        href={href}
        onClick={exitTheater}
        aria-current={on.current}
        title={rail ? label : undefined}
        className={
          rail
            ? `press flex items-center gap-3.5 rounded-[var(--r-md)] py-2.5 text-sm font-semibold ${rail.row} ${rail.pad} ${on.row}`
            : `flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold ${
                active ? "tint text-[var(--accent)]" : "text-[var(--fg-faint)]"
              }`
        }
        style={rail ? on.wash : undefined}
      >
        <Icon className={rail ? `size-[18px] shrink-0 ${on.icon}` : "size-[22px]"} />
        <span className={rail ? rail.label : undefined}>{label}</span>
      </Link>
    );
  });
}

export function Sidebar() {
  const { exitTheater, current, panelOpen } = usePlayerControls();
  const width = useRailWidth();
  // The rail snaps: it is either the icon floor or something wide enough for words, never
  // between. So one comparison tells the toggle which way it points.
  const wide = width > RAIL_ICONS;
  const panel = usePanelWidth();
  const viewport = useViewportWidth();
  const [filter, setFilter] = useState<Filter>("Queue");

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
    { max: RAIL_MAX, floor: RAIL_ICONS, dockedAt: RAIL_DOCK_MIN },
  );
  const resolve = (raw: number) => resolveRailWidth(raw, ceiling);

  return (
    <aside
        // Two <aside> elements are two "complementary" landmarks, and an unnamed one is
        // announced as just "complementary". The now-playing panel names itself; this one has
        // to as well or a reader cannot tell the two apart in a landmark list.
        aria-label="Sidebar"
        id={RAIL_ID}
        // `@container` here is what lets the labels follow the dragged width. It also makes this
        // element the containing block for any `position: fixed` inside it — the trap the page
        // wrappers already set — which is safe only because nothing in the rail is fixed.
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
          {/* The mark, and you. The wordmark that used to sit beside it said the app's name to
              someone already inside the app, and it was the only thing making this row wide;
              the space it freed is where your profile lives now, moved off the top bar.

              Two dresses again, and for the same reason the labels have them. A labelled rail
              has room for the mark and a 36px avatar side by side, so they share one row and
              the avatar takes the far end. An icon rail's content is 44px, which one of them
              fills on its own — so the row becomes a column and the avatar sits under the mark
              rather than being shrunk to fit beside it. `flex-col @[9rem]:flex-row`, the
              container query, not a JS branch: the rail's width is dragged, so there is no
              viewport query that could describe it, and this way the two layouts swap in the
              same paint as the width.

              The mark is `flex-1` only once the row is horizontal. In a column that would set
              its flex basis on the vertical axis and fight the `h-12`. */}
          <div className="flex flex-col @[9rem]:flex-row @[9rem]:items-center">
            {/* The mark and its own toggle are one box so that `group/brand` stops at the mark's
                row. It used to wrap the lot, which is why the chevron lit up from the far left. */}
            <div className="group/brand relative flex h-12 items-center @[9rem]:flex-1">
              <Link
                href="/"
                onClick={exitTheater}
                aria-label="Timbre — home"
                className={`press flex h-12 w-full items-center rounded-[var(--r-md)] ${RAIL.row} ${RAIL.pad}`}
              >
                <TimbreMark aria-hidden className="h-7 w-auto shrink-0 text-[var(--accent)]" />
              </Link>
              <RailToggle
                wide={wide}
                className="absolute right-1 @[9rem]:hidden group-hover/brand:pointer-events-auto group-hover/brand:opacity-100"
              />
            </div>

            {/* The chevron's slot at labelled width: real width in the row rather than something
                pinned over the mark, so approaching it is not the same gesture as approaching
                home. `hidden @[9rem]:grid` is the rail's own two-dresses idiom, one more time. */}
            <div
              className={`group/toggle hidden h-12 ${TOGGLE_ZONE} shrink-0 place-items-center @[9rem]:grid`}
            >
              <RailToggle
                wide={wide}
                className="group-hover/toggle:pointer-events-auto group-hover/toggle:opacity-100"
              />
            </div>

            <ProfileButton className="h-12 justify-center px-1 @[9rem]:justify-end @[9rem]:pr-2" />
          </div>

          <nav aria-label="Primary" className="flex flex-col gap-0.5">
            <NavLinks rail={RAIL} />
          </nav>

          <hr className="my-1.5 border-0 border-t border-[var(--line)]" />

          <LibraryCard style={RAIL} filter={filter} onFilter={setFilter} />
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
  );
}

function LibraryCard({
  style,
  filter,
  onFilter,
}: {
  style: RailStyle;
  filter: Filter;
  onFilter: (filter: Filter) => void;
}) {
  const { queue, current, play, exitTheater } = usePlayerControls();
  const { playlists, settled } = usePlaylists();
  const [list, edges] = useScrollEdges();
  const pathname = usePathname();
  // The same test the nav rows use for anything that is not "/", so the three agree on what
  // "you are here" means as well as on what it looks like. /library and its subpages both count.
  const on = activeRow(pathname.startsWith("/library"));

  const count = (filter === "Queue" ? queue.length : (playlists?.length ?? 0)) || "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Link
        href="/library"
        onClick={exitTheater}
        // `.focus-ring-inset`, for the same reason a tile's cover art uses it. This link is a
        // flex child of the `overflow: hidden` box above with no padding between them, so it is
        // flush left, right and top — and the ordinary ring is drawn *outside* the border box,
        // which means three of its four sides were clipped away. What a keyboard reader saw
        // when they reached their library was a white bar under the icon, not a ring.
        aria-current={on.current}
        style={on.wash}
        className={`focus-ring-inset press ${style.wide} items-center gap-3 rounded-[var(--r-md)] px-3.5 pb-2.5 pt-3 ${on.row}`}
      >
        <LibraryIcon className={`size-[18px] shrink-0 ${on.icon}`} />
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
        onClick={exitTheater}
        aria-label="Your library"
        title="Your library"
        aria-current={on.current}
        style={on.wash}
        className={`focus-ring-inset press ${style.narrow} shrink-0 items-center justify-center rounded-[var(--r-md)] px-2 pb-2.5 pt-3 ${on.row}`}
      >
        <LibraryIcon className={`size-[18px] shrink-0 ${on.icon}`} />
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
        // `pt-1` is 4px, and it is the focus ring's. A scroller clips at its padding box, the
        // ring is drawn 4px outside the row it belongs to, and the first row starts flush with
        // the top — so tabbing into the queue lit a ring with its top edge shaved off square.
        // The cost is 4px of rail: everything below moves down by it, and nothing else changes.
        className="edge-fade scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1"
      >
        {filter === "Playlists" ? (
          <>
            <div className={`${style.wide} flex-col`}>
              <LikedRow />
            </div>
            <Link
              href="/liked"
              title="Liked songs"
              className={`${style.narrow} mb-0.5 w-full items-center justify-center rounded-[var(--r-md)] p-1.5 hover:bg-[var(--surface-2)]`}
            >
              <LikedCover
                className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
                iconClassName="size-4"
              />
            </Link>
            <PlaylistRows playlists={playlists} settled={settled} style={style} />
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
                    onClick={() => play(song, queue)}
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

// Whether a scroll box has more above or below what it shows, so `.edge-fade` softens only an
// edge with something past it. Watched, not measured once: the queue grows, and switching tabs
// swaps the box's contents without resizing the box.

function PlaylistRows({
  playlists,
  settled,
  style,
}: {
  playlists: PlaylistSummary[] | null;
  settled: boolean;
  style: RailStyle;
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
