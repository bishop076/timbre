"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CheckIcon,
  ChevronIcon,
  HeartFilledIcon,
  HeartIcon,
  NextIcon,
  PlaylistAddIcon,
  PlayIcon,
  QueueAddIcon,
} from "../icons";
import { PlaylistPicker } from "../playlists/add-to-playlist";
import { getPlaylistsState, addSongToPlaylist } from "../playlists/store";
import { likeSong, unlikeSong, useIsLiked } from "../playlists/likes-store";
import { useMenuKeyboard } from "../playlists/use-anchored-menu";
import type { Song } from "../types";
import { usePlayerControls } from "./player-context";
import { sameTrack } from "./song-match";

const MENU_WIDTH = 208;
const MARGIN = 8;

interface Point {
  x: number;
  y: number;
}

export function useSongMenu(song: Song): {
  onContextMenu: (event: React.MouseEvent) => void;
  menu: React.ReactNode;
} {
  const [at, setAt] = useState<Point | null>(null);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    if (event.clientX > 0 || event.clientY > 0) return setAt({ x: event.clientX, y: event.clientY });
    const rect = event.currentTarget.getBoundingClientRect();
    setAt({ x: rect.left + 16, y: rect.bottom });
  }, []);

  return {
    onContextMenu,
    menu: at ? <SongMenu song={song} at={at} onClose={() => setAt(null)} /> : null,
  };
}

function SongMenu({ song, at, onClose }: { song: Song; at: Point; onClose: () => void }) {
  const { play, enqueue, playNext, queue, current } = usePlayerControls();
  const menu = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  // The playlist picker takes the panel over rather than hanging off it: a second floating layer
  // anchored to a menu that is itself anchored to the pointer has two ways to land off-screen.
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const queued = queue.some((entry) => sameTrack(entry, song));
  const playing = current !== null && sameTrack(current, song);
  const liked = useIsLiked(song);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Re-placed when the view changes as well as when the pointer does: the picker is much taller
  // than the four actions, and a menu opened near the bottom of the window would otherwise grow
  // straight off it.
  useLayoutEffect(() => {
    const height = menu.current?.offsetHeight ?? 0;
    const left = Math.min(at.x, window.innerWidth - MENU_WIDTH - MARGIN);
    const wantTop = at.y + height + MARGIN <= window.innerHeight ? at.y : at.y - height;
    const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);

    setPlaced({
      left: Math.max(MARGIN, left),
      top: Math.min(Math.max(MARGIN, wantTop), maxTop),
    });
  }, [at, picking]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    window.addEventListener("pointerdown", onPointerDown, { signal });
    window.addEventListener("keydown", onKeyDown, { signal });
    window.addEventListener("scroll", onClose, { capture: true, signal });
    window.addEventListener("resize", onClose, { signal });
    return () => listeners.abort();
  }, [onClose]);

  // Guarded, unlike the bare focus() it replaces: the hook below has already put focus on the
  // first item by the time this runs, and taking it back to the panel would undo that.
  useEffect(() => {
    if (placed && !menu.current?.contains(document.activeElement)) menu.current?.focus();
  }, [placed]);

  // Always open — this component only exists while the menu does — and the only menu in the
  // app with no trigger to return focus to, since a right-click is what raised it.
  useMenuKeyboard(menu, true, { returnFocus: true });

  // Saving keeps the menu up for a beat so the tick beside the list is seen, and holds it open
  // for good if the write failed — the alert the picker renders is the only notice of that.
  function save(playlistId: string) {
    addSongToPlaylist(playlistId, song);
    if (getPlaylistsState().error) return setSaved(null);
    setSaved(playlistId);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, 700);
  }

  const items = [
    { label: "Play now", icon: <PlayIcon className="size-4" />, action: () => play(song) },
    {
      label: "Play next",
      icon: <NextIcon className="size-4" />,
      action: () => playNext([song]),
      hint: playing ? "Playing" : undefined,
    },
    {
      label: "Add to queue",
      icon: queued ? <CheckIcon className="size-4" /> : <QueueAddIcon className="size-4" />,
      action: () => enqueue([song]),
      hint: queued ? "Queued" : undefined,
    },
    {
      label: "Add to playlist",
      icon: <PlaylistAddIcon className="size-4" />,
      // The one item that opens something rather than doing something, so it is the one that
      // does not close the menu.
      action: () => setPicking(true),
      keepOpen: true,
      more: true,
    },
    {
      label: liked ? "Unlike" : "Like",
      icon: liked ? (
        <HeartFilledIcon className="size-4 text-[var(--accent-text)]" />
      ) : (
        <HeartIcon className="size-4" />
      ),
      action: () => (liked ? unlikeSong(song) : likeSong(song)),
    },
  ];

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={song.title}
      tabIndex={-1}
      style={
        placed
          ? { left: placed.left, top: placed.top }
          : { left: 0, top: 0, visibility: "hidden" }
      }
      className={`slab fixed z-[100] w-52 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)] outline-none ${
        picking ? "" : "p-1.5"
      }`}
    >
      {picking ? (
        <>
          {/* Full-bleed inside a panel that is `overflow-hidden` and drops its padding in this
              mode, so an outer focus ring drawn beyond the border box is clipped off on three
              sides. `focus-ring-inset` is the utility for exactly that. */}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => setPicking(false)}
            className="focus-ring-inset flex w-full items-center gap-2 border-b-[length:var(--edge)] border-[var(--ink)] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)]"
          >
            <ChevronIcon className="size-4 shrink-0 rotate-90 text-[var(--fg-dim)]" />
            <span className="min-w-0 flex-1 truncate">Add to playlist</span>
          </button>
          <PlaylistPicker song={song} saved={saved} onSave={save} />
        </>
      ) : (
        items.map(({ label, icon, action, hint, keepOpen, more }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              action();
              if (!keepOpen) onClose();
            }}
            disabled={hint !== undefined}
            className="flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-2 text-left text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:cursor-default disabled:text-[var(--fg-dim)] disabled:hover:bg-transparent"
          >
            <span className="shrink-0 text-[var(--fg-dim)]">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {hint && <span className="shrink-0 text-[11px] text-[var(--fg-faint)]">{hint}</span>}
            {more && <ChevronIcon className="size-4 shrink-0 -rotate-90 text-[var(--fg-faint)]" />}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
