"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { exportProfile } from "../profile/profile-backup";
import { playlistsToCsv } from "./csv";
import { getLikedSongs, useLikes } from "./likes-store";
import { allPlaylists, exportPlaylists } from "./store";
import { useAnchoredMenu } from "./use-anchored-menu";

export function saveFile(contents: BlobPart, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const today = () => new Date().toISOString().slice(0, 10);

export function ExportMenu({ hasPlaylists, hasProfile }: { hasPlaylists: boolean; hasProfile: boolean }) {
  const hasLikes = useLikes().songs.length > 0;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const at = useAnchoredMenu(open, root, menu, 256);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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

  async function backup(withProfile: boolean) {
    setBusy(true);
    try {
      const profile = withProfile ? await exportProfile() : null;
      const file = exportPlaylists({ profile, liked: withProfile ? getLikedSongs() : [] });
      saveFile(
        JSON.stringify(file, null, 2),
        "application/json",
        `timbre-${withProfile ? "backup" : "playlists"}-${today()}.json`,
      );
    } finally {
      setBusy(false);
      close();
    }
  }

  function csv() {
    const liked = getLikedSongs();
    const lists = liked.length > 0 ? [{ name: "Liked songs", songs: liked }, ...allPlaylists()] : allPlaylists();
    saveFile(playlistsToCsv(lists), "text/csv;charset=utf-8", `timbre-playlists-${today()}.csv`);
    close();
  }

  const item =
    "flex w-full flex-col rounded-[var(--r-sm)] px-2.5 py-2 text-left hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((was) => !was)}
        disabled={!hasPlaylists && !hasProfile && !hasLikes}
        aria-haspopup="menu"
        aria-expanded={open}
        className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-semibold disabled:opacity-40"
      >
        Export
      </button>

      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Export"
          style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" }}
          className="slab fixed z-50 w-64 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] p-1.5 shadow-[var(--drop-lg)]"
        >
          <button type="button" role="menuitem" disabled={busy} onClick={() => void backup(true)} className={item}>
            <span className="text-[13px] font-semibold">Back up everything</span>
            <span className="text-[11px] leading-relaxed text-[var(--fg-faint)]">
              Playlists, liked songs, your name and pictures. For this browser or your next one.
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy || !hasPlaylists}
            onClick={() => void backup(false)}
            className={item}
          >
            <span className="text-[13px] font-semibold">Playlists only</span>
            <span className="text-[11px] leading-relaxed text-[var(--fg-faint)]">
              Nothing about you — for sending to someone.
            </span>
          </button>
          <button type="button" role="menuitem" disabled={!hasPlaylists && !hasLikes} onClick={csv} className={item}>
            <span className="text-[13px] font-semibold">Spreadsheet (CSV)</span>
            <span className="text-[11px] leading-relaxed text-[var(--fg-faint)]">
              To read or sort elsewhere. Timbre can&rsquo;t import it back.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
