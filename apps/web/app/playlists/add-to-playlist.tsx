"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);

  // Portalled into `document.body`, not rendered beside its button: shelves are
  // `overflow-x-auto`, and an absolutely positioned child of a scroll container is clipped
  // by it. Fixed coordinates also let it flip to whichever side has room.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Focus has to come back with the menu: it is portalled to the end of <body>, so the node
  // being dropped is nowhere near the row and the next Tab would restart at the top of the
  // document. An outside click closes without this, having moved focus itself.
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (open) loadPlaylists();
  }, [open]);

  // `useLayoutEffect` so the menu never appears at the wrong place first.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      // `rect`, not `trigger`: that name is the button's ref one scope up.
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;

      const WIDTH = 240;
      const MARGIN = 8;
      const wantLeft = rect.right - WIDTH;
      const left = Math.min(
        Math.max(MARGIN, wantLeft < MARGIN ? rect.left : wantLeft),
        window.innerWidth - WIDTH - MARGIN,
      );

      /*
       * Measured, not guessed. The menu is rendered before it is placed precisely so this
       * can read a real box: its height is the playlist list — shorter than its `max-h-56`
       * until there are enough playlists to fill it — plus the create form, so the old
       * constant of 260 described only the full case.
       */
      const height = menu.current?.offsetHeight ?? 260;
      const below = window.innerHeight - rect.bottom;

      /*
       * Above only when it genuinely fits better there. The old test compared the *gap*
       * below against 260 and then flipped on `rect.top > below`, which left the case that
       * matters unhandled: a trigger in the upper half of a short window has a below-gap
       * under 260 and a smaller top-gap, so the menu opened downwards and ran off the
       * bottom edge. Being `position: fixed`, what hangs off cannot be scrolled to — the
       * last playlists in the list were simply unreachable.
       */
      const fitsBelow = height + MARGIN <= below;
      const top = fitsBelow || below >= rect.top ? rect.bottom + 6 : rect.top - 6 - height;

      // The clamp is the backstop for the window that is too short for either side.
      const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);
      const next = { left, top: Math.min(Math.max(MARGIN, top), maxTop) };

      // Identity-stable, because this runs again the moment it has a height to measure and
      // a fresh object every time would re-render for as long as the menu stayed open.
      setAt((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
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
        close();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Focus moves in once the menu has somewhere to be, or Enter on the button leaves the next
  // Tab walking the page while the menu sits at the end of <body> — unreachable by keyboard.
  // The containment test stops a re-place on scroll from pulling focus out of the name field.
  useEffect(() => {
    if (!open || !at) return;
    if (!menu.current?.contains(document.activeElement)) menu.current?.focus();
  }, [open, at]);

  function save(playlistId: string) {
    addSongToPlaylist(playlistId, song);
    setSaved(playlistId);
    setTimeout(close, 700);
  }

  function createAndSave(event: React.FormEvent) {
    event.preventDefault();
    const name = creating.trim();
    if (!name) return;

    const playlist = createPlaylist(name);
    addSongToPlaylist(playlist.id, song);
    setCreating("");
    setSaved(playlist.id);
    setTimeout(close, 700);
  }

  return (
    <div ref={root} className={`relative ${className ?? ""}`}>
      <button
        ref={trigger}
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
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={`Playlists for ${song.title}`}
            tabIndex={-1}
            /*
             * Rendered before it is placed, which is what lets the layout effect above
             * measure a real box instead of assuming one — it used to be gated on `at` too,
             * so on the pass that decided the position there was no element to read.
             *
             * `visibility` rather than `display: none` for that single pre-paint frame: a
             * `display: none` element has no height either. Both effects run before the
             * browser paints, so this position is never seen.
             */
            style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" }}
            className="slab fixed z-[100] w-60 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)] outline-none"
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
