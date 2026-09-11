"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, HeartFilledIcon, HeartIcon, NextIcon, PlayIcon, QueueAddIcon } from "../icons";
import { likeSong, unlikeSong, useIsLiked } from "../playlists/likes-store";
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

  useLayoutEffect(() => {
    const height = menu.current?.offsetHeight ?? 0;

    const left = Math.min(at.x, window.innerWidth - MENU_WIDTH - MARGIN);
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
