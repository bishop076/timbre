"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PlusIcon } from "../icons";
import { SiteLinks } from "../shell/site-links";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { createPlaylist, exportPlaylists, importPlaylists, loadPlaylists, usePlaylists } from "./store";

/** Every playlist in this browser. A real route rather than only a rail, since the rail is
 * desktop-only and a phone would have no way back to what it saved. Export is the only way
 * to move playlists off this browser or survive clearing site data. */
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

  // A blob URL and a synthetic click — there is no export endpoint to send this to.
  function download() {
    const blob = new Blob([JSON.stringify(exportPlaylists(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `timbre-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    // In the document, revoked next turn: Firefox ignores a detached anchor outright, and
    // revoking on the same tick races the browser's own read.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
    <div /*
        The column must be taller than its content for `mt-auto` to push against.
        `min-h-full` does not work — a percentage min-height needs a definite height on
        every ancestor, which the scrolling panel does not offer. `dvh` rather than
        `vh` so a phone's collapsing address bar leaves no strip of dead space.
      */
      className="@container mx-auto flex min-h-[calc(100dvh-var(--nav-h))] w-full max-w-6xl flex-col px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-6 lg:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Your library</h1>

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
        Saved in this browser only.
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
          No playlists yet.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-3 gap-3 @md:grid-cols-3 @md:gap-4 @2xl:grid-cols-4 @4xl:grid-cols-5">
          {playlists?.map((playlist) => (
            <li key={playlist.id} className="group relative">
              {/* Outside the <Link>: a button in an anchor is invalid, and clicking it
                  would follow the link on the way to the menu. */}
              <PlaylistActions
                id={playlist.id}
                name={playlist.name}
                className="absolute right-3 top-3 z-10 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
              />
              <Link
                href={`/playlist/${playlist.id}`}
                className="block rounded-[var(--r-lg)] p-1.5 transition hover:bg-[var(--surface-2)] sm:p-2.5"
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
        The phone's route to About and Privacy. A reachable privacy policy is a
        condition of embedding the players Timbre depends on, and the desktop rail is
        `lg:flex`, so this cannot be desktop-only. `mt-auto` pushes it to the end of
        the page so it reads as a footer.
      */}
      <SiteLinks className="mt-auto justify-center pt-16 lg:hidden" />
    </div>
  );
}
