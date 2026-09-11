"use client";

import Link from "next/link";
import { useState } from "react";

import { CheckIcon, PlaylistAddIcon } from "../icons";
import type { Song } from "../types";
import { saveAsPlaylist } from "./save-collection";
import { usePlaylists } from "./store";

/**
 * "Save as playlist" for a page of songs: one press, a local playlist named after the page.
 *
 * Renders as two items of a wrapping flex row — the button, then a full-width line for the
 * confirmation — so it sits among the page's other actions and the notice drops beneath them.
 * Pressed once per visit: a second press would make a second copy, which nobody means to.
 */
export function SaveAsPlaylist({ name, songs }: { name: string; songs: readonly Song[] }) {
  const [saved, setSaved] = useState<{ id: string; name: string; count: number } | null>(null);
  const [empty, setEmpty] = useState(false);
  // A full browser storage is reported by the store rather than thrown, and it lands after
  // the first song that did not fit — so it is read from there, and only once this has saved.
  const { error } = usePlaylists();

  function save() {
    const result = saveAsPlaylist(name, songs);
    if (!result) {
      setEmpty(true);
      return;
    }
    setSaved({ id: result.playlist.id, name: result.playlist.name, count: result.saved });
  }

  return (
    <>
      <button
        type="button"
        onClick={save}
        disabled={songs.length === 0 || saved !== null}
        className="slab-sm press flex items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-4 py-2 text-[13px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] disabled:opacity-40"
      >
        {saved ? <CheckIcon className="size-4" /> : <PlaylistAddIcon className="size-4" />}
        {saved ? "Saved" : "Save as playlist"}
      </button>

      <p role="status" className="basis-full text-[13px] empty:hidden">
        {saved && error ? (
          <span className="text-red-400">{error}</span>
        ) : saved ? (
          <span className="text-[var(--accent)]">
            Saved {saved.count} {saved.count === 1 ? "song" : "songs"} to{" "}
            <Link href={`/playlist/${saved.id}`} className="font-semibold underline underline-offset-2">
              {saved.name}
            </Link>
            , on this device.
          </span>
        ) : empty ? (
          <span className="text-[var(--fg-dim)]">Nothing here can be saved — none of it has a copy to play.</span>
        ) : null}
      </p>
    </>
  );
}
