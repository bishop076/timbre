"use client";

import Link from "next/link";
import { useState } from "react";

import { CheckIcon, PlaylistAddIcon } from "../icons";
import type { Song } from "../types";
import { saveAsPlaylist } from "./save-collection";
import { usePlaylists } from "./store";

export function SaveAsPlaylist({ name, songs }: { name: string; songs: readonly Song[] }) {
  const [saved, setSaved] = useState<ReturnType<typeof saveAsPlaylist>>();
  const { error } = usePlaylists();

  return (
    <>
      <button
        type="button"
        onClick={() => setSaved(saveAsPlaylist(name, songs))}
        disabled={songs.length === 0 || Boolean(saved)}
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
            Saved {saved.saved} {saved.saved === 1 ? "song" : "songs"} to{" "}
            <Link href={`/playlist/${saved.playlist.id}`} className="font-semibold underline underline-offset-2">
              {saved.playlist.name}
            </Link>
            , on this device.
          </span>
        ) : saved === null ? (
          <span className="text-[var(--fg-dim)]">Nothing here can be saved — none of it has a copy to play.</span>
        ) : null}
      </p>
    </>
  );
}
