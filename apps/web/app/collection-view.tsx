"use client";

import { ArtistLink } from "./artist-link";
import { describeAge, movementOf, useChartSnapshot } from "./chart-memory";
import { Collage } from "./collage";
import { NoteIcon, PlayIcon, ShuffleIcon } from "./icons";
import { Movement } from "./movement";
import { AddToQueue } from "./player/add-to-queue";
import { usePlayer } from "./player/player-context";
import { AddToPlaylist } from "./playlists/add-to-playlist";
import type { Collection } from "@/lib/collection";
import { cover as coverSrc } from "./artwork-url";

/**
 * One collection, one page — the same layout as every other detail page. Nothing is
 * stored; the page is assembled per request from Deezer and thrown away.
 */
export function CollectionView({ collection }: { collection: Collection }) {
  const { play, current, state } = usePlayer();
  const { tracks } = collection;

  // Movement only for a chart — a playlist's order is whatever its editor typed. Pass
  // `null`, never a spare number: `-1` stopped it *writing* a snapshot but not reading
  // one, and `-1` is the fused ranking's key. See `chart-memory.ts`.
  const isChart = collection.kind === "genre";
  const snapshot = useChartSnapshot(isChart ? Number(collection.id) : null, tracks);

  function playAll(shuffled = false) {
    if (tracks.length === 0) return;
    const queue = shuffled ? shuffle(tracks) : tracks;
    play(queue[0]!, queue);
  }

  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
        {collection.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img
            src={coverSrc(collection.coverUrl, 400) ?? undefined}
            alt=""
            className="slab size-28 shrink-0 rounded-[var(--r-lg)] object-cover sm:size-44"
          />
        ) : (
          <Collage covers={collection.covers} className="slab size-28 shrink-0 sm:size-44" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            {collection.kind === "genre" ? "Chart" : "Collection"}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">
            {collection.title}
          </h1>
          <p className="mt-2 text-xs text-[var(--fg-faint)]">{collection.subtitle}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playAll()}
              disabled={tracks.length === 0}
              className="slab press flex items-center gap-2 rounded-[var(--r-full)] px-4 py-2 text-[13px] font-bold text-[var(--accent-fg)] disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              <PlayIcon className="size-4" />
              Play
            </button>
            <button
              type="button"
              onClick={() => playAll(true)}
              disabled={tracks.length === 0}
              className="slab-sm press flex items-center gap-2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-4 py-2 text-[13px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] disabled:opacity-40"
            >
              <ShuffleIcon className="size-4" />
              Shuffle
            </button>
          </div>

          {/* Said once here, not on every row. */}
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--fg-faint)]">
            Assembled from Deezer and kept nowhere. Playing a song searches for a copy Timbre can
            actually play, so an occasional match is a different upload of the same recording.
            {snapshot && (
              <>
                {" "}
                Movement is against the last time you opened this chart — {describeAge(snapshot.at)},
                on this device.
              </>
            )}
          </p>
        </div>
      </header>

      {tracks.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--fg-dim)]">
          Nothing in this one right now.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {tracks.map((track) => {
            const isCurrent = current?.id === track.id;
            return (
              <li
                key={track.id}
                className={`group flex items-center gap-2.5 rounded-lg px-2 transition sm:gap-3 ${
                  isCurrent ? "bg-[var(--accent-wash)]" : "hover:bg-[var(--surface-2)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => play(track, tracks)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left focus:outline-none sm:gap-3 sm:py-2.5"
                  aria-label={`Play ${track.title}`}
                >
                  <span className="w-6 shrink-0 text-right text-[13px] font-bold tabular-nums text-[var(--fg-faint)]">
                    {track.position}
                  </span>

                  <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-[var(--surface-1)] sm:size-11">
                    {track.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                      <img
                        src={coverSrc(track.artworkUrl, 112) ?? undefined}
                        alt=""
                        width={44}
                        height={44}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-[var(--fg-dim)]">
                        <NoteIcon className="size-4" />
                      </span>
                    )}
                    <span
                      className={`absolute inset-0 flex items-center justify-center bg-black/55 transition ${
                        isCurrent && state === "playing"
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      }`}
                    >
                      <PlayIcon className="size-4 text-white" />
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[14px] font-medium ${isCurrent ? "text-[var(--accent)]" : ""}`}
                    >
                      {track.title}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--fg-dim)]">
                      <ArtistLink artists={track.artists} />
                    </span>
                  </span>
                </button>

                <Movement delta={movementOf(snapshot, track.id, track.position)} />

                <AddToQueue
                  song={track}
                  className="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
                />
                <AddToPlaylist
                  song={track}
                  className="mr-1 shrink-0 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Fisher–Yates on a copy. `sort(() => random - 0.5)` is measurably biased. */
function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}
