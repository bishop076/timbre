"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, HeartFilledIcon, HeartIcon, NextIcon, PlayIcon, QueueAddIcon } from "../icons";
import { likeSong, unlikeSong, useIsLiked } from "../playlists/likes-store";
import type { Song } from "../types";
import { usePlayerControls } from "./player-context";
import { sameTrack } from "./song-match";

/**
 * Right-click a song, queue it. The trailing buttons on a row only appear on hover, which is
 * fine as decoration and useless as the *only* way in — a reader who does not know they are
 * there has no reason to sweep the cursor across a row to find out.
 *
 * A context menu is the discoverable version of the same actions: everyone already tries
 * right-clicking a list. It is deliberately short — the two ways to put a song somewhere in
 * the queue, the ordinary play, and the like, which is the one save that needs no choosing —
 * since a menu that lists everything is another thing to read rather than a shortcut.
 *
 * Positioned at the pointer, so it is not anchored to any element and cannot reuse
 * `useAnchoredMenu`. Portalled for the same reason that one is: shelves and panels are
 * scroll containers, and an absolutely positioned child of one is clipped by it.
 */
const MENU_WIDTH = 208;
const MARGIN = 8;

interface Point {
  x: number;
  y: number;
}

/**
 * Wires a row up to the menu. Returns the handler to put on the row and the menu itself,
 * which renders into a portal and so can go anywhere in the row's markup.
 */
export function useSongMenu(song: Song): {
  onContextMenu: (event: React.MouseEvent) => void;
  menu: React.ReactNode;
} {
  const [at, setAt] = useState<Point | null>(null);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    // Only the row's own menu, never the browser's. Shift+right-click still gets the
    // browser's, which is the usual escape hatch and worth leaving open.
    if (event.shiftKey) return;
    event.preventDefault();

    // The keyboard raises this event too — Shift+F10 and the menu key — and reports no
    // pointer, as a zero or a -1 depending on the browser. Fall back to the row itself, or
    // the menu opens in the top-left corner away from what it acts on.
    const useless = event.clientX <= 0 && event.clientY <= 0;
    if (useless) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setAt({ x: rect.left + 16, y: rect.bottom });
      return;
    }

    setAt({ x: event.clientX, y: event.clientY });
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

  const queued = queue.some((entry) => sameTrack(entry, song));
  const playing = current !== null && sameTrack(current, song);
  const liked = useIsLiked(song);

  // Measured, not assumed: the menu is short but its height still decides whether it opens
  // downwards. `useLayoutEffect` so the unplaced frame is never painted — the same trick
  // `useAnchoredMenu` documents at length.
  useLayoutEffect(() => {
    const height = menu.current?.offsetHeight ?? 0;

    const left = Math.min(at.x, window.innerWidth - MENU_WIDTH - MARGIN);
    // Down from the pointer by preference, up when there is no room below — and clamped
    // either way, for a window too short for either.
    const wantTop = at.y + height + MARGIN <= window.innerHeight ? at.y : at.y - height;
    const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);

    setPlaced({
      left: Math.max(MARGIN, left),
      top: Math.min(Math.max(MARGIN, wantTop), maxTop),
    });
  }, [at]);

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

    // Anchored to a point in the viewport rather than to an element, so a scroll leaves it
    // pointing at nothing: it closes instead of chasing the cursor's old position. Capturing,
    // so a scroll in any ancestor is seen and not only one on the window.
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Focus moves in once it has somewhere to be, or the next Tab walks the page while the
  // menu sits at the end of <body>, unreachable by keyboard.
  useEffect(() => {
    if (placed) menu.current?.focus();
  }, [placed]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

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
      className="slab fixed z-[100] w-52 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] p-1.5 shadow-[var(--drop-lg)] outline-none"
    >
      <Item icon={<PlayIcon className="size-4" />} onClick={() => run(() => play(song))}>
        Play now
      </Item>

      <Item
        icon={<NextIcon className="size-4" />}
        onClick={() => run(() => playNext([song]))}
        disabled={playing}
        hint={playing ? "Playing" : undefined}
      >
        Play next
      </Item>

      <Item
        icon={queued ? <CheckIcon className="size-4" /> : <QueueAddIcon className="size-4" />}
        onClick={() => run(() => enqueue([song]))}
        disabled={queued}
        hint={queued ? "Queued" : undefined}
      >
        Add to queue
      </Item>

      <Item
        icon={
          liked ? (
            <HeartFilledIcon className="size-4 text-[var(--accent)]" />
          ) : (
            <HeartIcon className="size-4" />
          )
        }
        onClick={() => run(() => (liked ? unlikeSong(song) : likeSong(song)))}
      >
        {liked ? "Unlike" : "Like"}
      </Item>
    </div>,
    document.body,
  );
}

/** One row of the menu. `hint` says why a disabled item is disabled — "nothing happened" and
 * "it is already there" are otherwise the same event. */
function Item({
  icon,
  onClick,
  disabled,
  hint,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2 py-2 text-left text-[13px] font-medium text-[var(--fg)] hover:bg-[var(--surface-2)] disabled:cursor-default disabled:text-[var(--fg-dim)] disabled:hover:bg-transparent"
    >
      <span className="shrink-0 text-[var(--fg-dim)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-[var(--fg-faint)]">{hint}</span>}
    </button>
  );
}
