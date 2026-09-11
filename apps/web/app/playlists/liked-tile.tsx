"use client";

import Link from "next/link";

import { HeartFilledIcon } from "../icons";
import { useLikes } from "./likes-store";

export function LikedCover({
  className,
  iconClassName,
}: {
  className: string;
  iconClassName: string;
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

function useCount(): string {
  const { songs, settled } = useLikes();
  return settled ? `${songs.length} ${songs.length === 1 ? "song" : "songs"}` : " ";
}

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
        <span className="block text-xs text-[var(--fg-dim)]">{count}</span>
      </Link>
    </li>
  );
}

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
        <span className="block truncate text-[11px] text-[var(--fg-dim)]">{count}</span>
      </span>
    </Link>
  );
}
