"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, PlaylistAddIcon, PlusIcon } from "../icons";
import type { Song } from "../types";
import { addSongToPlaylist, createPlaylist, loadPlaylists, usePlaylists } from "./store";

/**
 * Saves a song to a playlist.
 *
 * A menu rather than a heart, because Timbre has no single "liked songs" list —
 * a playlist is the only container there is, so the question is always *which
 * one*, and a one-tap control would have to invent an answer.
 *
 * Saving needs no account and touches no network: playlists live in this
 * browser. That is why there is no signed-out state here any more, and why the
 * whole interaction is synchronous.
 */
export function AddToPlaylist({ song, className }: { song: Song; className?: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [creating, setCreating] = useState("");

  const { playlists, error } = usePlaylists();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /*
   * The menu is rendered into `document.body`, not beside its button.
   *
   * Two things were breaking it in place. Shelves scroll horizontally, so their
   * container is `overflow-x-auto` — and an absolutely positioned child of a
   * scroll container is **clipped by it**, which cut the menu off mid-list. And
   * anchoring to the button's right edge sent the menu off the left of the
   * screen for the first tile in a row.
   *
   * A portal escapes every ancestor's overflow, and fixed coordinates measured
   * from the trigger let it flip to whichever side actually has room.
   */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (open) loadPlaylists();
  }, [open]);

  /*
   * Measured before paint, so the menu never appears at the wrong place first.
   * `useLayoutEffect` rather than `useEffect` for exactly that reason.
   */
  useLayoutEffect(() => {
    // Nothing to place while closed, and nothing to clear either: the position
    // is only ever read when `open` is true, so it can go stale harmlessly
    // rather than being reset on the way out.
    if (!open) return;

    const place = () => {
      const trigger = root.current?.getBoundingClientRect();
      if (!trigger) return;

      const WIDTH = 240;
      const MARGIN = 8;
      // Prefer growing left from the button's right edge, which keeps the menu
      // under the control. Flip when that would cross the viewport's left edge.
      const wantLeft = trigger.right - WIDTH;
      const left = Math.min(
        Math.max(MARGIN, wantLeft < MARGIN ? trigger.left : wantLeft),
        window.innerWidth - WIDTH - MARGIN,
      );

      // Open upward when there is more room above than below — the menu is tall
      // and the button is often near the bottom of a shelf.
      const below = window.innerHeight - trigger.bottom;
      const top = below < 260 && trigger.top > below ? trigger.top - 8 - 260 : trigger.bottom + 6;

      setAt({ left, top: Math.max(MARGIN, top) });
    };

    place();
    // Anything that moves the trigger moves the menu with it, rather than
    // leaving it stranded where the button used to be.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Dismiss on an outside click or Escape. Both, because a menu that only
  // closes one way is a menu that gets stranded open.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The menu lives in a portal, so it is not inside `root` any more and
      // has to be checked separately or every click in it would close it.
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
    // Long enough to read the tick, short enough not to feel stuck.
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
