"use client";

import Link from "next/link";
import { useEffect } from "react";

import { HeartFilledIcon } from "../icons";
import { loadLikes, useLikes } from "./likes-store";

/** Liked songs' cover: a heart on the accent, not a collage. Every playlist is a collage, and
 * the one list that is not a playlist should be findable among them at a glance. */
export function LikedCover({
  className = "",
  iconClassName = "size-8",
}: {
  /** Applied to the wrapper, so the caller controls size and shape — as `PlaylistCover`. */
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={`tint flex items-center justify-center text-[var(--accent-fg)] ${className}`}
      style={{ background: "var(--accent)" }}
    >
      <HeartFilledIcon className={iconClassName} />
    </span>
  );
}

/** "3 songs", or nothing until storage has been read — a zero there first would be a lie. */
function useCount(): string {
  const { songs, settled } = useLikes();

  useEffect(() => {
    loadLikes();
  }, []);

  if (!settled) return "";
  return `${songs.length} ${songs.length === 1 ? "song" : "songs"}`;
}

/** Liked songs as the first tile of the library grid — shaped like the playlist tiles
 * beside it, so it reads as one of the lists rather than as a banner above them. */
export function LikedTile() {
  const count = useCount();

  return (
    <li className="group relative">
      <Link
        href="/liked"
        className="block rounded-[var(--r-lg)] p-1.5 transition hover:bg-[var(--surface-2)] sm:p-2.5"
      >
        <LikedCover
          className="slab aspect-square w-full rounded-[var(--r-md)]"
          iconClassName="size-1/3"
        />
        <span className="mt-2.5 block truncate text-sm font-semibold">Liked songs</span>
        {/* A space rather than nothing before the read, so the tile keeps its height. */}
        <span className="block text-xs text-[var(--fg-dim)]">{count || " "}</span>
      </Link>
    </li>
  );
}

/** The same entry in the desktop rail, shaped like the playlist rows under it. */
export function LikedRow() {
  const count = useCount();

  return (
    <Link
      href="/liked"
      className="mb-0.5 flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 text-left hover:bg-[var(--surface-2)]"
    >
      <LikedCover className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]" iconClassName="size-4" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">Liked songs</span>
        <span className="block truncate text-[11px] text-[var(--fg-dim)]">{count || " "}</span>
      </span>
    </Link>
  );
}
