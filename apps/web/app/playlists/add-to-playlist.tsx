"use client";

import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (open) loadPlaylists();
  }, [open]);

  // Dismiss on an outside click or Escape. Both, because a menu that only
  // closes one way is a menu that gets stranded open.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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

      {open && (
        <div
          role="menu"
          className="slab absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)]"
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
        </div>
      )}
    </div>
  );
}
