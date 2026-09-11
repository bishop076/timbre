"use client";

import { Artwork } from "./artwork";
import { PlayIcon } from "./icons";
import { usePlayerControls } from "./player/player-context";
import type { Song } from "./types";

export function MixHero({ songs, personal }: { songs: Song[]; personal: boolean }) {
  const { play } = usePlayerControls();

  if (songs.length === 0) return null;

  const covers = songs.filter((song) => song.artworkUrl).slice(0, 4);

  return (
    <section className="mb-2 lg:hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
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

      {covers.length > 0 && (
        <div className="relative mt-5 aspect-[2/1] w-full" aria-hidden>
          {covers.map((song, index) => {
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
