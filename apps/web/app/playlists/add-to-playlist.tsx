"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, PlaylistAddIcon, PlusIcon } from "../icons";
import type { Song } from "../types";
import { addSongToPlaylist, createPlaylist, loadPlaylists, usePlaylists } from "./store";
import { useAnchoredMenu } from "./use-anchored-menu";

export function AddToPlaylist({ song, className }: { song: Song; className?: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [creating, setCreating] = useState("");

  const { playlists, error } = usePlaylists();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const at = useAnchoredMenu(open, root, menu, 240);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
    trigger.current?.focus();
  }, [cancelClose]);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      const active = document.activeElement;
      const ours =
        !active ||
        active === document.body ||
        menu.current?.contains(active) ||
        root.current?.contains(active);
      setOpen(false);
      if (ours) trigger.current?.focus();
    }, 700);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (open) loadPlaylists();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || menu.current?.contains(target)) return;
      cancelClose();
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
  }, [open, close, cancelClose]);

  useEffect(() => {
    if (!open || !at) return;
    if (!menu.current?.contains(document.activeElement)) menu.current?.focus();
  }, [open, at]);

  function save(playlistId: string) {
    addSongToPlaylist(playlistId, song);
    setSaved(playlistId);
    closeSoon();
  }

  function createAndSave(event: React.FormEvent) {
    event.preventDefault();
    const name = creating.trim();
    if (!name) return;

    const playlist = createPlaylist(name);
    addSongToPlaylist(playlist.id, song);
    setCreating("");
    setSaved(playlist.id);
    closeSoon();
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
