"use client";

import Link from "next/link";

import { ArtistLink } from "../artist-link";
import { formatDuration } from "../duration";
import { HeartFilledIcon, HeartIcon, PlayIcon, ShuffleIcon } from "../icons";
import { Page, PageHeader } from "../page-chrome";
import { usePlayerControls } from "../player/player-context";
import { LikedCover } from "../playlists/liked-tile";
import { unlikeSong, useLikes } from "../playlists/likes-store";
import { SongRow } from "../song-row";
import { SourceBadges } from "../source-badges";
import type { Song } from "../types";
import { seededShuffle } from "@/lib/rotation";

/* Play and Shuffle carry the same geometry as the pair on /collection, so the two pages read as
   one app. What is gone is the chunky end of it: the old Play here was `px-5 py-2.5 text-sm`,
   half a step larger than every other primary button in the app, which is exactly the kind of
   weight the redesign is removing. */
const BUTTON =
  "press flex items-center gap-2 rounded-[var(--r-full)] px-4 py-2 text-[13px] transition";
const BAR = "animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]";

/* Label and font weight of each real button, so the placeholder that stands in for it is the
   same width as well as the same height. */
const PENDING_BUTTONS = [
  ["Play", "font-bold"],
  ["Shuffle", "font-semibold"],
] as const;

/** "3 hr 12 min" — the shape a collection's running time is read in, not a clock. */
function runningTime(songs: Song[]): string | null {
  const total = songs.reduce((sum, song) => sum + (song.durationMs ?? 0), 0);
  const minutes = Math.round(total / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function LikedView() {
  const { play, current, state } = usePlayerControls();
  const { songs, settled, error } = useLikes();

  const total = runningTime(songs);

  function playAll(shuffled = false) {
    const queue = shuffled ? seededShuffle(songs, Math.random() * 2 ** 32) : songs;
    const first = queue[0];
    if (first) play(first, queue);
  }

  return (
    <Page>
      {/* The header renders before the likes have loaded rather than after. The artwork, the
          eyebrow and the title are all known without reading storage, so there is nothing to
          wait for and nothing to shimmer — only the count line and the buttons are unknown, and
          those two reserve their exact height below. The page this replaced showed a bare
          "Loading…" in a container with different padding, so the whole header arrived late and
          in a different place. */}
      <PageHeader
        art={
          <LikedCover
            className="slab size-28 shrink-0 rounded-[var(--r-lg)] sm:size-40"
            iconClassName="size-10 sm:size-14"
          />
        }
        eyebrow="Collection"
        title="Liked songs"
      >
        {/* h-5 either way: one line of --text-meta, held open so the count does not push the
            buttons down when it arrives. */}
        <div className="mt-2 flex h-5 items-center text-[length:var(--text-meta)] text-[var(--fg-faint)]">
          {settled ? (
            <p>
              {songs.length} {songs.length === 1 ? "song" : "songs"}
              {total && ` · ${total}`} · only on this device
            </p>
          ) : (
            <div className={`h-3 w-48 ${BAR}`} aria-hidden />
          )}
        </div>

        {/* The placeholders are the buttons, with the ink taken out: same padding, same border,
            same icon box, same words. That makes their size correct by construction rather than
            by a measured magic number that goes stale the moment BUTTON changes. A reader with
            nothing liked does lose this row when it settles — the empty state is seen once, a
            full list every visit, so that is the cheaper of the two jumps. */}
        <div className="mt-4 flex items-center gap-2">
          {!settled ? (
            <>
              {PENDING_BUTTONS.map(([label, weight]) => (
                <div
                  key={label}
                  aria-hidden
                  className={`${BUTTON} ${weight} slab-sm animate-pulse bg-[var(--surface-2)] text-transparent`}
                >
                  <span className="size-4" />
                  {label}
                </div>
              ))}
            </>
          ) : (
            songs.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => playAll()}
                  className={`${BUTTON} slab-sm font-bold text-[var(--accent-fg)]`}
                  style={{ background: "var(--accent)" }}
                >
                  <PlayIcon className="size-4" />
                  Play
                </button>
                <button
                  type="button"
                  onClick={() => playAll(true)}
                  className={`${BUTTON} slab-sm bg-[var(--surface-2)] font-semibold text-[var(--fg-dim)] hover:text-[var(--fg)]`}
                >
                  <ShuffleIcon className="size-4" />
                  Shuffle
                </button>
              </>
            )
          )}
        </div>
      </PageHeader>

      {error && (
        <p role="alert" className="mb-4 text-[length:var(--text-body)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {!settled ? (
        <LikedPending />
      ) : songs.length === 0 ? (
        <LikedEmpty />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {songs.map((song, position) => (
            <SongRow
              key={song.id}
              song={song}
              onPlay={() => play(song, [...songs.slice(position), ...songs.slice(0, position)])}
              isCurrent={current?.id === song.id}
              isPlaying={state === "playing"}
              rank={position + 1}
              subtitle={<ArtistLink artists={song.artists} />}
              trailing={
                <>
                  <SourceBadges
                    song={song}
                    className="hidden opacity-0 transition group-hover:opacity-100 @xl:flex"
                  />

                  <span className="hidden w-12 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--fg-dim)] @md:block">
                    {formatDuration(song.durationMs)}
                  </span>

                  <button
                    type="button"
                    onClick={() => unlikeSong(song)}
                    aria-label={`Remove ${song.title} from Liked songs`}
                    title="Remove from Liked songs"
                    className="press tint mr-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-text)] hover:bg-[var(--surface-1)]"
                  >
                    <HeartFilledIcon className="size-[18px]" />
                  </button>
                </>
              }
            />
          ))}
        </ul>
      )}
    </Page>
  );
}

/**
 * Six rows at SongRow's own measurements — `px-2`, `gap-2.5 py-2 sm:gap-4 sm:py-3`, a
 * `size-10 sm:size-12` thumbnail — so a loaded list lands on the same lines the skeleton drew.
 * Six is what a 690px window has room for under the header; more would only be grey below the
 * fold, and there is nothing beneath the list for a late row to displace.
 */
function LikedPending() {
  return (
    <>
      <p role="status" className="sr-only">
        Loading your liked songs.
      </p>
      <ul aria-hidden className="divide-y divide-[var(--line)]">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <li key={row} className="flex items-center gap-3 px-2 sm:gap-4">
            <div className={`h-3 w-6 shrink-0 ${BAR}`} />
            <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 sm:gap-4 sm:py-3">
              <div className="size-10 shrink-0 animate-pulse rounded-md bg-[var(--surface-2)] sm:size-12" />
              <div className="min-w-0 flex-1">
                <div className={`h-3.5 w-2/5 ${BAR}`} />
                <div className={`mt-2 h-3 w-1/4 ${BAR}`} />
              </div>
            </div>
            <div className={`mr-1 hidden h-3 w-12 shrink-0 @md:block ${BAR}`} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * An empty state with somewhere to go. The old one was a full-width grey strip holding a single
 * centred sentence — it told you the list was empty, which you could already see, and left you
 * on a dead page. This says the same thing in a heading, explains the gesture once underneath,
 * and offers the one link that fixes it.
 *
 * A `slab` card on `--surface-1`: white against the blush page in light, a lifted warm black in
 * dark, with the ink edge the references draw around a card. It is the only thing on the page
 * below the header, so it should look like a card rather than a tinted gap.
 */
function LikedEmpty() {
  return (
    <div className="slab flex flex-col items-center gap-3 rounded-[var(--r-lg)] bg-[var(--surface-1)] px-6 py-10 text-center">
      <HeartIcon aria-hidden className="size-7 text-[var(--fg-faint)]" />

      {/* No eyebrow above this. "Nothing here yet" over "Songs you like land here" is the same
          sentence twice, and on a 690px window every repeated line costs something. */}
      <p className="text-[length:var(--text-section)] font-bold tracking-[var(--track-title)]">
        Songs you like land here
      </p>

      <p className="max-w-md text-[length:var(--text-body)] leading-relaxed text-[var(--fg-dim)]">
        Press the heart beside what&rsquo;s playing, or right-click any song and choose it from
        the menu. Your likes stay on this device.
      </p>

      <Link
        href="/explore"
        className={`${BUTTON} slab-sm mt-1 bg-[var(--surface-2)] font-semibold text-[var(--fg-dim)] hover:text-[var(--fg)]`}
      >
        Find something to like
      </Link>
    </div>
  );
}
