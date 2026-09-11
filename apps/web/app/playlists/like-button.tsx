"use client";

import { useEffect, useId } from "react";

import { HeartFilledIcon, HeartIcon } from "../icons";
import type { Song } from "../types";
import { likeSong, loadLikes, unlikeSong, useIsLiked, useLikes } from "./likes-store";

export function LikeButton({ song, className = "size-8" }: { song: Song; className?: string }) {
  const liked = useIsLiked(song);
  const { error } = useLikes();
  const described = useId();

  useEffect(() => {
    loadLikes();
  }, []);

  return (
    <button
      type="button"
      onClick={() => (liked ? unlikeSong(song) : likeSong(song))}
      aria-label={`Like ${song.title}`}
      aria-pressed={liked}
      aria-describedby={error ? described : undefined}
      title={error ?? (liked ? "Remove from Liked songs" : "Save to Liked songs")}
      className={`press flex shrink-0 items-center justify-center rounded-[var(--r-full)] hover:bg-[var(--surface-1)] ${className} ${
        error
          ? "text-amber-500"
          : liked
            ? "tint text-[var(--accent)]"
            : "text-[var(--fg-dim)] hover:text-[var(--fg)]"
      }`}
    >
      {liked ? <HeartFilledIcon className="size-[18px]" /> : <HeartIcon className="size-[18px]" />}
      {error && (
        <span id={described} className="sr-only">
          {error}
        </span>
      )}
    </button>
  );
}
