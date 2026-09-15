"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { moveBetweenItems } from "../a11y/arrow-nav";
import { PlusIcon } from "../icons";
import { Caption, Notice } from "../page-chrome";
import { importHistory } from "../player/history-store";
import { useFilePicker } from "../profile/image-picker";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { applyProfile, hasLocalProfile } from "../profile/profile-backup";
import { readProfileExport, type ProfileExport } from "../profile/profile-file";
import { importPlayLog } from "../stats/play-log";
import { ExportMenu } from "./export-menu";
import { importLikedSongs } from "./likes-store";
import { LikedTile } from "./liked-tile";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { usePlaylistImages } from "./playlist-image";
import { createPlaylist, importPlaylists, loadPlaylists, usePlaylists } from "./store";
import type { PlaylistSummary } from "./store";

export const PLAYLIST_GRID =
  "grid grid-cols-2 gap-3 @md:grid-cols-3 @md:gap-4 @2xl:grid-cols-4 @4xl:grid-cols-5";

export function PlaylistGrid({
  playlists,
  editable = false,
  className = "",
  children,
}: {
  playlists: PlaylistSummary[];
  editable?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const uploaded = usePlaylistImages();
  const grid = useRef<HTMLUListElement>(null);

  // Arrows walk the grid the way it looks rather than the way it is written: Down goes down a
  // row, not to the next tile in source order, and how many tiles that is depends on how wide the
  // panel currently is. Tab is untouched, so the per-tile actions button stays reachable.
  return (
    <ul
      ref={grid}
      onKeyDown={(event) => moveBetweenItems(event, grid.current, "grid")}
      className={`${className} ${PLAYLIST_GRID}`.trim()}
    >
      {children}
      {playlists.map((playlist) => (
        <li key={playlist.id} className={editable ? "group relative" : undefined}>
          {editable && (
            <PlaylistActions
              id={playlist.id}
              name={playlist.name}
              className="absolute right-3 top-3 z-10 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
            />
          )}
          <Link
            href={`/playlist/${playlist.id}`}
            className={`block rounded-[var(--r-lg)] transition hover:bg-[var(--surface-2)] ${
              editable ? "p-1.5 sm:p-2.5" : "p-2.5"
            }`}
          >
            <PlaylistCover
              covers={playlist.covers}
              coverUrl={playlist.coverUrl}
              uploaded={uploaded[playlist.id]}
              className="aspect-square w-full rounded-[var(--r-md)]"
            />
            <span className="mt-2.5 block truncate text-sm font-semibold">{playlist.name}</span>
            <span className="block text-xs text-[var(--fg-dim)]">
              {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const listOf = (names: string[]) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function LibraryView() {
  const { playlists, settled, error } = usePlaylists();
  const profile = useLocalProfile();
  const images = useLocalImages();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [offered, setOffered] = useState<ProfileExport | null>(null);
  const picker = useFilePicker("application/json,.json", "Couldn't read that file.", async (file) => {
    setNotice(null);
    setOffered(null);
    const data = JSON.parse(await file.text()) as {
      liked?: unknown;
      profile?: unknown;
      history?: unknown;
      plays?: unknown;
    };
    const added = importPlaylists(data);
    const likes = importLikedSongs(data.liked);
    // Version 2 files carry neither, and say so by leaving the keys out.
    const played = importHistory(data.history) + importPlayLog(data.plays);
    const lists = [
      added > 0 || likes === 0 ? `${added} playlist${added === 1 ? "" : "s"}` : null,
      likes > 0 ? `${likes} liked song${likes === 1 ? "" : "s"}` : null,
      played > 0 ? `${played} play${played === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const incoming = readProfileExport(data.profile);

    if (incoming && !hasLocalProfile()) {
      await applyProfile(incoming);
      setNotice(
        added > 0 || likes > 0 || played > 0
          ? `Imported ${lists}, and your profile.`
          : "Imported your profile.",
      );
    } else {
      setOffered(incoming);
      setNotice(`Imported ${lists}.`);
    }
  });

  useEffect(() => {
    loadPlaylists();
  }, []);

  function create(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createPlaylist(trimmed);
    setName("");
  }

  async function adopt(incoming: ProfileExport) {
    setOffered(null);
    try {
      const applied = await applyProfile(incoming);
      setNotice(
        applied.length === 3
          ? "Profile replaced with the one from the file."
          : `Took the ${listOf(applied)} from the file; the rest of your profile is unchanged.`,
      );
    } catch (cause) {
      picker.setError(cause instanceof Error ? cause.message : "Couldn't use that profile.");
    }
  }

  // No `min-h` on the column below. It re-derived the scrolling panel's own height from
  // `100dvh` and `--chrome-b`, then had to undo itself with `lg:min-h-0` because `--chrome-b`
  // counts a bottom nav that `lg:` hides. Nothing here stretches to fill it, so all it bought
  // was a second copy of the shell's arithmetic that had to stay in step with the shell.
  return (
    <div className="@container mx-auto flex w-full max-w-6xl flex-col px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Your library</h1>

        <div className="flex items-center gap-2">
          {picker.input}
          <button
            type="button"
            onClick={picker.open}
            className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-semibold"
          >
            Import
          </button>
          <ExportMenu
            hasPlaylists={Boolean(playlists?.length)}
            hasProfile={Boolean(profile.name || images.avatar || images.banner)}
          />
        </div>
      </div>

      <Caption className="mt-1.5">Saved in this browser only.</Caption>

      <form onSubmit={create} className="mt-5 flex max-w-md gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New playlist name…"
          maxLength={120}
          className="slab min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm outline-none placeholder:text-[var(--fg-faint)]"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="slab-sm press flex shrink-0 items-center gap-1.5 rounded-[var(--r-md)] px-4 py-2.5 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          <PlusIcon className="size-4" />
          Create
        </button>
      </form>

      {(picker.error ?? error) && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {picker.error ?? error}
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-[var(--accent)]">{notice}</p>}
      {offered && (
        <div className="mt-3 flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[var(--fg-dim)]">
            The file also has a profile
            {offered.name ? (
              <>
                {" "}
                for <span className="font-semibold text-[var(--fg)]">{offered.name}</span>
              </>
            ) : null}
            . Yours was kept.
          </p>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => void adopt(offered)}
              className="slab-sm press rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12px] font-bold text-[var(--accent-fg)]"
              style={{ background: "var(--accent)" }}
            >
              Use the file’s
            </button>
            <button
              type="button"
              onClick={() => setOffered(null)}
              className="press rounded-[var(--r-sm)] bg-[var(--surface-3)] px-2.5 py-1.5 text-[12px] font-semibold"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}

      {settled && playlists?.length === 0 && <Notice className="mt-8">No playlists yet.</Notice>}
      {settled && (
        <PlaylistGrid playlists={playlists ?? []} editable className="mt-6">
          <LikedTile />
        </PlaylistGrid>
      )}

    </div>
  );
}
