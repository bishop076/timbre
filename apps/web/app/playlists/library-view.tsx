"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { PlusIcon } from "../icons";
import { applyProfile, hasLocalProfile } from "../profile/profile-backup";
import { readProfileExport, type ProfileExport } from "../profile/profile-file";
import { useLocalImages } from "../profile/local-images";
import { useLocalProfile } from "../profile/local-profile";
import { SiteLinks } from "../shell/site-links";
import { ExportMenu } from "./export-menu";
import { LikedTile } from "./liked-tile";
import { PlaylistActions } from "./playlist-actions";
import { PlaylistCover } from "./playlist-cover";
import { createPlaylist, importPlaylists, loadPlaylists, usePlaylists } from "./store";

/** Every playlist in this browser. A real route rather than only a rail, since the rail is
 * desktop-only and a phone would have no way back to what it saved. Export is the only way
 * to move playlists off this browser or survive clearing site data. */
export function LibraryView() {
  const { playlists, settled, error } = usePlaylists();
  const profile = useLocalProfile();
  const images = useLocalImages();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A backup's profile, held while the reader decides: this browser already has one, and an
  // import never replaces something without being asked — see `profile-backup.ts`.
  const [offered, setOffered] = useState<ProfileExport | null>(null);
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

  async function upload(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setNotice(null);
    setOffered(null);
    try {
      const data: unknown = JSON.parse(await file.text());
      const added = importPlaylists(data);
      const lists = `${added} playlist${added === 1 ? "" : "s"}`;
      const incoming = readProfileExport((data as { profile?: unknown }).profile);

      if (incoming && !hasLocalProfile()) {
        // Nothing here to lose, so a backup restores itself.
        await applyProfile(incoming);
        setNotice(added > 0 ? `Imported ${lists} and your profile.` : "Imported your profile.");
      } else {
        if (incoming) setOffered(incoming);
        setNotice(`Imported ${lists}.`);
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Couldn't read that file.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function adoptOffered() {
    if (!offered) return;
    const incoming = offered;
    setOffered(null);
    try {
      await applyProfile(incoming);
      setNotice("Profile replaced with the one from the file.");
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Couldn't use that profile.");
    }
  }

  const isEmpty = settled && playlists?.length === 0;

  return (
    <div /*
        The column must be taller than its content for `mt-auto` to push against.
        `min-h-full` does not work — a percentage min-height needs a definite height on
        every ancestor, which the scrolling panel does not offer. `dvh` rather than
        `vh` so a phone's collapsing address bar leaves no strip of dead space.

        `--chrome-b` is the bar and the nav together, published by <AppShell> because their
        combined height depends on whether anything is playing. Subtracting `--nav-h` alone
        was right only with the player bar absent; with it, this column ran `--bar-h` past
        the bottom of the panel and the library scrolled into 96px of nothing. `--safe-t`
        goes with it because `dvh` is the whole screen while the panel starts below the
        status bar — see the `body` padding in globals.css.
      */
      className="@container mx-auto flex min-h-[calc(100dvh-var(--safe-t)-var(--chrome-b))] w-full max-w-6xl flex-col px-4 pb-16 pt-9 sm:px-7 sm:pb-20 sm:pt-6 lg:min-h-0">
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
          <ExportMenu
            hasPlaylists={Boolean(playlists?.length)}
            hasProfile={Boolean(profile.name || images.avatar || images.banner)}
          />
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
              onClick={() => void adoptOffered()}
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

      {isEmpty && (
        <p className="mt-8 text-sm leading-relaxed text-[var(--fg-dim)]">
          No playlists yet.
        </p>
      )}
      {/* Not only when there are playlists: Liked songs leads the grid either way, and on a
          phone this grid is the only way to it. Held for the read, or that tile would stand
          alone for a frame before the playlists joined it. */}
      {settled && (
        /* Two up until the container is wide enough for three. `@md:grid-cols-3` was
           already here and already dead, repeating the base — which is the tell: three
           across a phone leaves each tile about 88px, and the cover loses another 20px to
           the link's padding, so a playlist called anything at all truncated to roughly six
           characters. The breakpoint that was meant to introduce the third column now
           does. */
        <ul className="mt-6 grid grid-cols-2 gap-3 @md:grid-cols-3 @md:gap-4 @2xl:grid-cols-4 @4xl:grid-cols-5">
          <LikedTile />
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
