"use client";

import { Artwork } from "./artwork";
import { PlayIcon } from "./icons";
import { usePlayerControls } from "./player/player-context";
import type { Song } from "./types";

/** The phone's home screen: one mix, one button, with the shelves after it. `lg:hidden` —
 * on a desktop this is a large empty banner where a wall of covers belongs. */
export function MixHero({ songs, personal }: { songs: Song[]; personal: boolean }) {
  const { play } = usePlayerControls();

  // The shelves below still render, so this is a missing flourish, not an empty page.
  if (songs.length === 0) return null;

  // Four at most, and only songs with a cover: a placeholder note icon in the collage looks
  // broken rather than sparse, and past four the scatter reads as a misaligned grid.
  const covers = songs.filter((song) => song.artworkUrl).slice(0, 4);

  return (
    <section className="mb-2 lg:hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Two lines on purpose: on one it is just a heading, with nothing under it. */}
          <h1 className="text-[2.75rem] font-extrabold leading-[0.92] tracking-tight">
            Your
            <br />
            Mix
          </h1>
          <p className="mt-2 text-xs text-[var(--fg-dim)]">
            {personal ? "Built from what you've played" : "Popular right now"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => play(songs[0]!, songs)}
          aria-label="Play your mix"
          className="slab press tint flex size-16 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-fg)]"
          style={{ background: "var(--accent)" }}
        >
          <PlayIcon className="size-7 translate-x-0.5" />
        </button>
      </div>

      {/* Percentages inside a fixed-aspect box, so the cluster scales rather than
          overflowing a 320px phone. */}
      {covers.length > 0 && (
        <div className="relative mt-5 aspect-[2/1] w-full" aria-hidden>
          {covers.map((song, index) => {
            // One anchor and three satellites, ordered so one or two covers still look arranged.
            const spots = [
              "left-[26%] top-[6%] w-[46%]",
              "left-[2%] top-[30%] w-[20%]",
              "left-[74%] top-[16%] w-[17%]",
              "left-[64%] top-[58%] w-[24%]",
            ];
            return (
              <span key={`${song.id}-${index}`} className={`absolute ${spots[index]}`}>
                <Artwork
                  src={song.artworkUrl}
                  className="slab-sm aspect-square size-full rounded-[var(--r-full)]"
                  iconClassName="size-4"
                />
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
