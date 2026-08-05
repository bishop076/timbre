"use client";

import { Artwork } from "./artwork";
import { PlayIcon } from "./icons";
import { usePlayer } from "./player/player-context";
import type { Song } from "./types";

/**
 * The phone's home screen: one mix, one button.
 *
 * A deliberate inversion of the desktop home, which opens with shelves to
 * browse. A phone is picked up to *start something*, usually one-handed and
 * often while walking — so the first screen offers a single decision the size
 * of a thumb, and the shelves come after it rather than before.
 *
 * `lg:hidden`: on a desktop this would be a large empty banner where a wall of
 * covers belongs, and the shelves are already the better answer at that width.
 *
 * The arrangement — oversized title, one round play button, a scatter of
 * circular covers — follows the pattern Material You music apps have settled
 * on, PixelPlayer among them. Written here from scratch; none of its files are
 * used, and none could be, since it is proprietary.
 */
export function MixHero({ songs, personal }: { songs: Song[]; personal: boolean }) {
  const { play } = usePlayer();

  // Nothing to play means nothing to offer. The shelves below still render, so
  // this is a missing flourish rather than an empty page.
  if (songs.length === 0) return null;

  /*
   * Four covers at most, and only songs that have one.
   *
   * A collage with a placeholder note icon in it looks broken rather than
   * sparse, and four is where the scatter still reads as a cluster instead of
   * a grid that lost its alignment.
   */
  const covers = songs.filter((song) => song.artworkUrl).slice(0, 4);

  return (
    <section className="mb-2 lg:hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/*
            Two lines on purpose. "Your Mix" set across two lines at this weight
            is the shape the whole screen is built around — on one line it is
            just a heading, and the covers below have nothing to sit under.
          */}
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

      {/*
        The covers, scattered rather than gridded.

        Sized and placed in percentages inside a fixed-aspect box, so the
        cluster scales with the screen instead of overflowing a narrow one —
        the failure mode of absolute pixel offsets on a 320px phone.
      */}
      {covers.length > 0 && (
        <div className="relative mt-5 aspect-[2/1] w-full" aria-hidden>
          {covers.map((song, index) => {
            // Four fixed positions: one anchor and three satellites. Ordered so
            // a mix with only one or two covers still looks arranged.
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
