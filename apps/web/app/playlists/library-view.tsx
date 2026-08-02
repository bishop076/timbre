"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PlusIcon } from "../icons";
import { SiteLinks } from "../shell/site-links";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { createPlaylist, exportPlaylists, importPlaylists, loadPlaylists, usePlaylists } from "./store";

/**
 * Every playlist in this browser.
 *
 * A real route rather than only a rail, because the rail is desktop-only —
 * below `lg` it is replaced by a bottom nav, and without this page a phone
 * could save playlists and then have no way back to them.
 *
 * Export is given the same weight as create, which is unusual for a music app
 * and correct for this one: playlists live in this browser only, so a file is
 * the sole way to move them to another device or survive clearing site data.
 */
export function LibraryView() {
  const { playlists, settled, error } = usePlaylists();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  /**
   * Hands the file to the browser rather than to a server.
   *
   * A blob URL and a synthetic click is the whole mechanism — there is no
   * export endpoint, because the data was never anywhere but here.
   */
  function download() {
    const blob = new Blob([JSON.stringify(exportPlaylists(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Dated, because the point of an export is having more than one.
    link.download = `timbre-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setNotice(null);
    try {
      const added = importPlaylists(JSON.parse(await file.text()));
      setNotice(`Imported ${added} playlist${added === 1 ? "" : "s"}.`);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Couldn't read that file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const isEmpty = settled && playlists?.length === 0;

  return (
    <div className="@container mx-auto w-full max-w-6xl px-5 pb-10 pt-6 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Your library</h1>

        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void upload(event.target.files?.[0])}
            className="sr-only"
            aria-hidden
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-semibold"
          >
            Import
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!playlists?.length}
            className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[13px] font-semibold disabled:opacity-40"
          >
            Export
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-faint)]">
        Saved in this browser only — Timbre keeps no copy. Export to move them somewhere else.
      </p>

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

      {(problem ?? error) && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {problem ?? error}
        </p>
      )}
      {notice && <p className="mt-3 text-sm text-[var(--accent)]">{notice}</p>}

      {isEmpty ? (
        <p className="mt-8 text-sm leading-relaxed text-[var(--fg-dim)]">
          No playlists yet. Name one above, or save a song from anywhere in Timbre.
        </p>
      ) : (
        <ul className="mt-7 grid grid-cols-2 gap-4 @md:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5">
          {playlists?.map((playlist) => (
            <li key={playlist.id} className="group relative">
              {/* Outside the <Link>, not inside it: a button nested in an
                  anchor is invalid, and clicking it would follow the link on
                  the way to opening the menu. */}
              <PlaylistActions
                id={playlist.id}
                name={playlist.name}
                className="absolute right-3 top-3 z-10 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
              />
              <Link
                href={`/playlist/${playlist.id}`}
                className="block rounded-[var(--r-lg)] p-2.5 transition hover:bg-[var(--surface-2)]"
              >
                <PlaylistCover
                  covers={playlist.covers}
                  className="slab aspect-square w-full rounded-[var(--r-md)]"
                />
                <span className="mt-2.5 block truncate text-sm font-semibold">
                  {playlist.name}
                </span>
                <span className="block text-xs text-[var(--fg-dim)]">
                  {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
        The phone's route to About and Privacy.

        The rail carries these on desktop, but it is `lg:flex` and the bottom
        nav has only two entries — this page and search. Since a reachable
        privacy policy is a condition of embedding the players Timbre depends
        on, it cannot be desktop-only. `lg:hidden` keeps it from appearing twice
        where the rail already has it.
      */}
      <SiteLinks className="mt-10 justify-center lg:hidden" />
    </div>
  );
}
