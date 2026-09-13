"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, PlaylistAddIcon, PlusIcon } from "../icons";
import { Caption } from "../page-chrome";
import type { Song } from "../types";
import {
  addSongToPlaylist,
  createPlaylist,
  getPlaylistsState,
  loadPlaylists,
  playlistsHolding,
  usePlaylists,
} from "./store";
import { useAnchoredMenu } from "./use-anchored-menu";

export function AddToPlaylist({ song, className }: { song: Song; className?: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [creating, setCreating] = useState("");
  const { playlists, error } = usePlaylists();
  const { open, setOpen, close, root, trigger, menu, placed, style } = useAnchoredMenu();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nothing used to say a list already held this song — the menu showed a track count and
  // nothing else — so a second click on a list you had just saved to silently stored a
  // duplicate. The store refuses the duplicate now; this is the half that says so.
  const holding = open ? playlistsHolding(song.id) : null;

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    loadPlaylists();
    return cancelClose;
  }, [open, cancelClose]);

  useEffect(() => {
    if (placed && !menu.current?.contains(document.activeElement)) menu.current?.focus();
  }, [placed, menu]);

  function closeSoon() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      const active = document.activeElement;
      const ours =
        !active ||
        active === document.body ||
        menu.current?.contains(active) ||
        root.current?.contains(active);
      close(Boolean(ours));
    }, 700);
  }

  function save(playlistId: string) {
    addSongToPlaylist(playlistId, song);
    // A failed write leaves the mutated playlist in memory, so the row still reads as saved
    // while the song is in fact gone on reload. The warning `persist()` publishes used to be
    // rendered inside this menu and then closed over 700 ms later, taking the only notice of
    // the failure with it. Hold the menu open instead and let the alert stand.
    if (getPlaylistsState().error) {
      setSaved(null);
      return;
    }
    setSaved(playlistId);
    closeSoon();
  }

  function createAndSave(event: React.FormEvent) {
    event.preventDefault();
    const name = creating.trim();
    if (!name) return;
    setCreating("");
    save(createPlaylist(name).id);
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
            style={style}
            className="slab fixed z-[100] w-60 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)] outline-none"
          >
            <div className="scroller max-h-56 overflow-y-auto p-1.5">
              {playlists?.length === 0 && (
                <Caption className="px-2 py-2.5">No playlists yet. Name one below.</Caption>
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
                  {saved === playlist.id || holding?.has(playlist.id) ? (
                    <CheckIcon
                      className="size-4 shrink-0 text-[var(--accent)]"
                      aria-label="Already in this playlist"
                    />
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
              <p
                role="alert"
                className="border-t-[length:var(--edge)] border-[var(--ink)] px-3 py-2 text-[11px] text-red-400"
              >
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
