"use client";

import { useEffect, useId } from "react";

import { HeartFilledIcon, HeartIcon } from "../icons";
import type { Song } from "../types";
import { likeSong, loadLikes, unlikeSong, useIsLiked, useLikes } from "./likes-store";

/**
 * The heart: one press saves a song to Liked songs, with no list to choose — the thing
 * <AddToPlaylist> cannot be. Sized by the caller, as that one is, so it sits in the bar and
 * in the phone's larger transport alike.
 *
 * Filled as well as coloured when on. The accent follows the artwork and on some covers is
 * too quiet to carry a state alone; the shape change carries it whatever the colour.
 */
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
      // The label names the action and `aria-pressed` the state, so a screen reader hears
      // "Like <song>, pressed" rather than a label that changes under the reader's cursor.
      aria-label={`Like ${song.title}`}
      aria-pressed={liked}
      aria-describedby={error ? described : undefined}
      title={error ?? (liked ? "Remove from Liked songs" : "Save to Liked songs")}
      className={`press flex shrink-0 items-center justify-center rounded-[var(--r-full)] hover:bg-[var(--surface-1)] ${className} ${
        // Amber, as the bar marks every other problem: a heart that fills but will not
        // survive a reload has to look different from one that will.
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
