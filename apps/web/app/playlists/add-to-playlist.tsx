"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, PlaylistAddIcon, PlusIcon } from "../icons";
import type { Song } from "../types";
import { addSongToPlaylist, createPlaylist, loadPlaylists, usePlaylists } from "./store";

/** Saves a song to a playlist. A menu rather than a heart, since there is no single
 * "liked songs" list. Playlists are local, so the interaction is synchronous. */
export function AddToPlaylist({ song, className }: { song: Song; className?: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [creating, setCreating] = useState("");

  const { playlists, error } = usePlaylists();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Portalled into `document.body`, not rendered beside its button: shelves are
  // `overflow-x-auto`, and an absolutely positioned child of a scroll container is clipped
  // by it. Fixed coordinates also let it flip to whichever side has room.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (open) loadPlaylists();
  }, [open]);

  // `useLayoutEffect` so the menu never appears at the wrong place first.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = root.current?.getBoundingClientRect();
      if (!trigger) return;

      const WIDTH = 240;
      const MARGIN = 8;
      const wantLeft = trigger.right - WIDTH;
      const left = Math.min(
        Math.max(MARGIN, wantLeft < MARGIN ? trigger.left : wantLeft),
        window.innerWidth - WIDTH - MARGIN,
      );

      const below = window.innerHeight - trigger.bottom;
      const top = below < 260 && trigger.top > below ? trigger.top - 8 - 260 : trigger.bottom + 6;

      setAt({ left, top: Math.max(MARGIN, top) });
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The menu is in a portal, so it is not inside `root` and needs its own check.
      if (root.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function save(playlistId: string) {
    addSongToPlaylist(playlistId, song);
    setSaved(playlistId);
    setTimeout(() => setOpen(false), 700);
  }

  function createAndSave(event: React.FormEvent) {
    event.preventDefault();
    const name = creating.trim();
    if (!name) return;

    const playlist = createPlaylist(name);
    addSongToPlaylist(playlist.id, song);
    setCreating("");
    setSaved(playlist.id);
    setTimeout(() => setOpen(false), 700);
  }

  return (
    <div ref={root} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={`Add ${song.title} to a playlist`}
        aria-expanded={open}
        title="Save to a playlist"
        className="press flex size-8 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-1)] hover:text-[var(--fg)]"
      >
        <PlaylistAddIcon className="size-[18px]" />
      </button>

      {open &&
        at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ left: at.left, top: at.top }}
            className="slab fixed z-[100] w-60 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)]"
          >
          <div className="scroller max-h-56 overflow-y-auto p-1.5">
            {playlists?.length === 0 && (
              <p className="px-2 py-2.5 text-xs leading-relaxed text-[var(--fg-faint)]">
                No playlists yet. Name one below.
              </p>
            )}

            {playlists?.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                role="menuitem"
                onClick={() => save(playlist.id)}
                className="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-2 py-2 text-left text-[13px] font-medium hover:bg-[var(--surface-2)]"
              >
                <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                {saved === playlist.id ? (
                  <CheckIcon className="size-4 shrink-0 text-[var(--accent)]" />
                ) : (
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-faint)]">
                    {playlist.trackCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <form
            onSubmit={createAndSave}
            className="flex gap-1.5 border-t-[length:var(--edge)] border-[var(--ink)] p-1.5"
          >
            <input
              value={creating}
              onChange={(event) => setCreating(event.target.value)}
              placeholder="New playlist…"
              maxLength={120}
              className="min-w-0 flex-1 rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 py-1.5 text-[13px] outline-none placeholder:text-[var(--fg-faint)]"
            />
            <button
              type="submit"
              disabled={!creating.trim()}
              aria-label="Create playlist and add this song"
              className="press flex size-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--accent-fg)] disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              <PlusIcon className="size-4" />
            </button>
          </form>

            {error && (
              <p role="alert" className="border-t-[length:var(--edge)] border-[var(--ink)] px-3 py-2 text-[11px] text-red-400">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
