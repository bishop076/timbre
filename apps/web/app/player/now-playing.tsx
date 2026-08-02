"use client";

import { ArtistLink } from "../artist-link";
import type { ReactNode } from "react";

import { Artwork } from "../artwork";
import { ChevronIcon, CloseIcon, CollapseIcon, ExpandIcon, ExternalIcon } from "../icons";
import { sourceStyle } from "../sources";
import type { Song } from "../types";
import { ArtistCard } from "./artist-card";
import { MobileTransport } from "./mobile-transport";
import { usePlayer } from "./player-context";
import { SimilarSongs } from "./similar-songs";
import { PanelTabs } from "./panel-tabs";
import { SoundCloudPlayer } from "./soundcloud-player";
import { YouTubePlayer } from "./youtube-player";

/** Track length for the credits list. */
function clock(ms: number | null): string | null {
  if (ms === null) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/** One credit line, absent entirely when the sources do not publish it. */
function Credit({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-[var(--fg-faint)]">{label}</dt>
      <dd className={`min-w-0 flex-1 truncate ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * A queued song, wherever one is listed. Shared with `similar-songs.tsx`.
 *
 * The row is a container with a button inside rather than one big button,
 * because queue rows carry their own controls and a button cannot legally hold
 * another one — browsers drop the inner control, and screen readers announce
 * whatever survives as a single unlabelled target. `actions` is the slot for
 * them; without it this renders exactly as it did before.
 */
export function QueueRow({
  song,
  onPlay,
  actions,
}: {
  song: Song;
  onPlay: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="group/row flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 hover:bg-[var(--surface-2)]">
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus:outline-none"
      >
        <Artwork
          src={song.artworkUrl}
          className="slab-sm size-10 shrink-0 rounded-[var(--r-sm)]"
          iconClassName="size-4"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{song.title}</span>
          <span className="block truncate text-[11px] text-[var(--fg-dim)]">
            <ArtistLink artists={song?.artists ?? []} />
          </span>
        </span>
      </button>
      {actions}
    </div>
  );
}

/**
 * Reorder and remove, for one queued row.
 *
 * Up/down rather than drag: dragging needs a pointer, and the queue is one of
 * the few lists here that is genuinely edited on a phone. Buttons work with
 * touch, keyboard and screen readers without a second implementation, and the
 * queue is short enough that stepping is not tedious.
 *
 * Hidden until the row is hovered or something inside it takes focus — but
 * `focus-within`, not `focus`, so tabbing to a control keeps its siblings
 * visible instead of making each one vanish as you move between them.
 */
function QueueActions({
  onUp,
  onDown,
  onRemove,
  title,
}: {
  onUp: (() => void) | null;
  onDown: (() => void) | null;
  onRemove: () => void;
  title: string;
}) {
  const button =
    "flex size-6 items-center justify-center rounded-[var(--r-sm)] text-[var(--fg-dim)] transition hover:bg-[var(--surface-3)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-25";

  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-0.5 opacity-0 transition group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      <button
        type="button"
        onClick={onUp ?? undefined}
        disabled={!onUp}
        aria-label={`Move ${title} up`}
        className={button}
      >
        <ChevronIcon className="size-3.5 rotate-180" />
      </button>
      <button
        type="button"
        onClick={onDown ?? undefined}
        disabled={!onDown}
        aria-label={`Move ${title} down`}
        className={button}
      >
        <ChevronIcon className="size-3.5" />
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${title}`} className={button}>
        <CloseIcon className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The now-playing panel — the third column.
 *
 * Spotify's shell is three columns, not two: a library rail, the content, and a
 * panel on the right for what is playing right now. That third column is what
 * makes the layout read as a music app rather than a search page with a bar
 * stuck to the bottom, so this is it: the video, the current track, and what is
 * coming up.
 *
 * It has **three shapes and one element**:
 *
 * - phone → a floating card above the mini player, video only
 * - desktop → a real column beside the content
 * - theater → the column takes over the content area, video large with the
 *   queue beside it, the way YouTube Music expands a music video
 *
 * All three are the same DOM, restyled. That is not a shortcut — it is the
 * requirement. Rendering the player in a different place per shape would
 * re-parent its iframe, and browsers **reload** a re-parented iframe: the song
 * would stop and restart every time you expanded it.
 *
 * The video still has **no controls of its own**. Play, pause, seek, skip and
 * hiding this panel all live in the player bar, so there is exactly one place
 * that acts on playback whether or not the current track has pictures. The only
 * thing clicking the picture does is change its size.
 *
 * It cannot be a thumbnail either. YouTube's IFrame API requires at least
 * 200×200 and fails below it with a bare "Video unavailable" — see docs/BUGS.md
 * B-1, which is what actually broke this app once. So hiding clips the panel
 * away at full size rather than shrinking it, and the player keeps its
 * dimensions the whole time.
 */
export function NowPlayingPanel() {
  const {
    current,
    state,
    problem,
    activeSource,
    soundcloudUrl,
    panelOpen,
    theater,
    toggleTheater,
    queue,
    index,
    radio,
    play,
    move,
    removeAt,
    clearQueue,
  } = usePlayer();

  const active = current !== null;
  const open = active && panelOpen;
  const expanded = open && theater;

  /*
   * What is actually coming, in order: the rest of the queue, then the blend
   * the player will step into when the queue runs out.
   *
   * Showing only the queue made the panel say "nothing after this one" while
   * five recommendations sat one track away, ready and already fetched — a
   * panel that contradicts what the player is about to do.
   */
  const queued = queue.slice(index + 1);
  const known = new Set(queue.map((song) => song.id));
  const suggested = radio.filter((song) => !known.has(song.id));
  const upcoming = [...queued, ...suggested];
  const source = sourceStyle(activeSource ?? "ytmusic");

  const youtubeUrl =
    current?.sources.find((item) => item.source === "ytmusic")?.url ??
    (current
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
          [current.title, current.artists[0]].filter(Boolean).join(" "),
        )}`
      : null);

  /*
   * Widths are explicit rather than `w-full` on purpose. Closing the column
   * collapses the *outer* box to zero and clips, while the card inside keeps its
   * real size — which is what keeps the player above 200×200 while hidden. A
   * percentage width would collapse with the parent and take playback with it.
   */
  /*
   * The column appears at `xl`, not `lg`. At 1024 a 256px rail plus a 368px
   * column leaves the content under 400px — two tiles per shelf and a clipped
   * search box. Between `lg` and `xl` the panel stays the floating card, which
   * costs nothing but overlap; below `lg` it also has to clear the bottom nav,
   * which is why the offset is breakpointed too.
   */
  const shell = expanded
    ? "flex min-h-0 min-w-0 flex-1 p-2 lg:pl-0"
    : `fixed bottom-[calc(var(--bar-h)+var(--nav-h)+0.75rem)] right-3 z-40 transition-all duration-300 ease-[var(--ease)] lg:bottom-[calc(var(--bar-h)+0.75rem)] xl:static xl:z-auto xl:shrink-0 xl:overflow-hidden xl:p-2 xl:pl-0 xl:transition-[width] ${
        open
          ? "translate-y-0 opacity-100 xl:w-[23rem]"
          : "pointer-events-none translate-y-3 opacity-0 xl:w-0 xl:p-0"
      }`;

  const card = expanded
    ? "flex min-h-0 w-full flex-1 flex-col gap-2 xl:flex-row"
    : "slab flex w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:h-full xl:w-[22.5rem] xl:max-w-none";

  /*
   * Expanded, the video box fills its half of the row rather than being sized
   * to 16:9 and centred. Centring a 16:9 box left an empty band above and below
   * it while the queue beside it ran full height — two columns of different
   * heights, which is what made the expanded view look out of proportion. The
   * video letterboxes itself inside a filled box, so this trades a shaped
   * border for a straight one.
   */
  /*
   * `min-h-[200px]` is a compliance floor, not a taste decision.
   *
   * YouTube's IFrame API refuses to play below 200×200 and reports only a bare
   * "Video unavailable" — the bug in docs/BUGS.md B-1. Expanded, this box is
   * `aspect-video` at the full width of the column, so a 320px-wide phone would
   * compute a 171px height and every track would fail on exactly the devices
   * least able to explain why. The minimum wins over the aspect ratio; the
   * player letterboxes inside it.
   */
  const videoBox = expanded
    ? "slab relative min-h-[200px] w-full shrink-0 overflow-hidden rounded-[var(--r-lg)] bg-black aspect-video xl:aspect-auto xl:h-full xl:min-h-0 xl:w-auto xl:min-w-0 xl:shrink xl:flex-1"
    : "relative shrink-0 bg-black";

  const listBox = expanded
    ? // Below `xl` the queue is hidden and the transport takes the slot instead:
      // on a phone, controls you can reach are worth more than a list you can
      // scroll to anyway, and both together leave room for neither.
      "slab hidden min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:flex xl:h-full xl:w-[21rem] xl:flex-none"
    : // Docked on a phone the floating card is the video and nothing else —
      // there is no room for a panel beside a mini player, and the expanded
      // view is one tap away for anyone who wants one.
      "hidden min-h-0 flex-1 flex-col xl:flex";

  return (
    <aside className={shell} aria-hidden={!open} aria-label="Now playing">
      <div className={card}>
        <div className={videoBox}>
          {/*
            Some songs exist only as uploads that bar embedding everywhere. That
            cannot be worked around — it is the rights holder's setting — so the
            honest fallback is a link to the one place it will play.
          */}
          {state === "unplayable" && youtubeUrl && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-[var(--surface-2)] px-3 py-2.5 text-xs font-medium text-[var(--fg)] transition hover:text-[var(--accent)]"
            >
              {problem ?? "Can't play this here"}
              <ExternalIcon className="size-3" />
            </a>
          )}

          {/*
            The picture's only affordance. It sits *over* the player rather than
            on it, because the player deliberately takes no pointer input at all
            — that is what stops YouTube painting its own hover overlay of title,
            channel and share buttons across the video. Clicks land here instead
            and never reach the iframe.
          */}
          <button
            type="button"
            onClick={toggleTheater}
            aria-label={expanded ? "Shrink video" : "Expand video"}
            aria-pressed={expanded}
            className="group absolute inset-0 z-10 flex cursor-pointer items-start justify-end p-2 focus:outline-none"
          >
            <span className="slab-sm flex size-8 items-center justify-center rounded-[var(--r-sm)] bg-[var(--surface-1)] text-[var(--fg)] opacity-0 transition duration-200 ease-[var(--ease)] group-hover:opacity-100 group-focus-visible:opacity-100">
              {expanded ? (
                <CollapseIcon className="size-4" />
              ) : (
                <ExpandIcon className="size-4" />
              )}
            </span>
          </button>

          {/*
            Exactly one player is mounted at a time. Unmounting the other is what
            makes "only one audible" true by construction rather than by careful
            pausing — a torn-down player cannot be restarted by a stray event
            during handoff. It costs a remount on every source switch, which is
            the right trade for never having two songs at once.
          */}
          {activeSource === "soundcloud" ? (
            <SoundCloudPlayer
              trackUrl={soundcloudUrl}
              size={expanded ? "h-full w-full" : "h-[200px] w-full"}
            />
          ) : (
            <YouTubePlayer size={expanded ? "h-full w-full" : "h-[200px] w-full"} />
          )}
        </div>

        {/*
          Two different panels, one slot. Docked it is Spotify's: what is
          playing, who made it, what it is made of — with the queue reduced to
          the single next track at the bottom, because a column that is mostly a
          list of songs you have already queued tells you nothing you did not
          just do. Expanded there is room for the whole queue, which is what
          YouTube Music puts beside a video, so that is what goes there.

          Only this subtree swaps. The video is a sibling and keeps its place in
          the tree, so it never reloads.
        */}
        <div className={listBox}>
          {expanded ? (
            <>
              <div className="flex items-start gap-3 border-b-[length:var(--edge)] border-[var(--ink)] px-4 pb-3 pt-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{current?.title ?? "Nothing playing"}</p>
                  <p className="truncate text-xs text-[var(--fg-dim)]">
                    <ArtistLink artists={current?.artists ?? []} />
                  </p>
                </div>
                <span
                  className="mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
                  style={{ color: source.color, backgroundColor: source.tint }}
                >
                  {source.short}
                </span>
              </div>

              {/*
                Up next, Lyrics and Related — YouTube Music's arrangement.
                The queue stays here rather than moving into <PanelTabs>,
                because it is this component's own state and lifting it
                would give two places an opinion about what plays next.
              */}
              <PanelTabs
                queue={
                  <>
                  <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                    <span className="text-[11px] tabular-nums text-[var(--fg-faint)]">
                      {upcoming.length || ""} coming up
                    </span>
                    {/* Clears the queued songs only. The suggestions below them are
                        not in the queue — they are what plays if nothing is — so
                        there is nothing there to clear. */}
                    {queued.length > 0 && (
                      <button
                        type="button"
                        onClick={clearQueue}
                        className="ml-auto rounded-[var(--r-sm)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--fg-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="scroller-quiet min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    {upcoming.length === 0 ? (
                      <p className="px-2 py-4 text-xs leading-relaxed text-[var(--fg-faint)]">
                        Nothing after this one. Playing a song from a shelf queues the rest of it.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {upcoming.map((song, position) => {
                          /*
                           * Only the queued half is editable. The suggestions after
                           * it are a live recommendation that is refetched on every
                           * track change, so "remove" there would delete something
                           * that reappears a song later — a control that visibly
                           * does not work. Playing one still queues it, which is
                           * the way to act on a suggestion.
                           */
                          const queuedHere = position < queued.length;
                          const at = index + 1 + position;
                          const last = index + queued.length;

                          return (
                            <li key={`${song.id}-${position}`}>
                              {/* Where the queue ends and the blend begins. Labelled
                                  rather than blended in, so "queued" and "suggested"
                                  never look like the same promise. */}
                              {position === queued.length && queued.length > 0 && (
                                <p className="px-1.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--fg-faint)]">
                                  Then, from your blend
                                </p>
                              )}
                              <QueueRow
                                song={song}
                                onPlay={() => play(song, upcoming)}
                                actions={
                                  queuedHere ? (
                                    <QueueActions
                                      title={song.title}
                                      // Never above the playing song: the queue
                                      // behind `index` is history, and promoting a
                                      // track into it would silently drop it.
                                      onUp={at > index + 1 ? () => move(at, at - 1) : null}
                                      onDown={at < last ? () => move(at, at + 1) : null}
                                      onRemove={() => removeAt(at)}
                                    />
                                  ) : undefined
                                }
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  </>
                }
              />
            </>
          ) : (
            <>
              <div className="scroller-quiet min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold leading-tight">
                      {current?.title ?? "Nothing playing"}
                    </p>
                    <p className="truncate text-xs text-[var(--fg-dim)]">
                      <ArtistLink artists={current?.artists ?? []} />
                    </p>
                  </div>
                  {/* Attribution names the source actually playing. Every
                      service Timbre embeds requires it, and it is the only way
                      to tell whose player you are hearing. */}
                  <span
                    className="mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
                    style={{ color: source.color, backgroundColor: source.tint }}
                  >
                    {source.short}
                  </span>
                </div>

                <ArtistCard name={current?.artists[0] ?? null} />

                {current && (
                  <section className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5">
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
                      Credits
                    </h3>
                    {/* Only what the sources actually publish. No free
                        catalogue exposes writers or producers, so those lines
                        are absent rather than guessed at. */}
                    <dl className="space-y-1 text-[11px]">
                      <Credit label="Performed by" value={current.artists.join(", ") || null} />
                      <Credit label="Album" value={current.album} />
                      <Credit label="Length" value={clock(current.durationMs)} />
                      <Credit label="ISRC" value={current.isrc} mono />
                      <Credit
                        label="Available on"
                        value={current.sources.map((item) => sourceStyle(item.source).short).join(", ")}
                      />
                    </dl>
                  </section>
                )}

                <SimilarSongs />

                {/*
                  The queue, reduced to the one thing worth knowing: what plays
                  when this ends.

                  **Inside the scroll area, not pinned below it.** Pinned, it ate
                  a fixed slice of a column that is already narrow, and whatever
                  sat above was clipped mid-row — the credits list was being cut
                  through the middle of a line with nothing to indicate more
                  existed. Scrolling with the rest costs its permanent visibility
                  and buys a panel where nothing is ever severed.
                */}
                {upcoming[0] && (
                  <div className="border-t-[length:var(--edge)] border-[var(--ink)] pt-2.5">
                    <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
                      Next in queue
                      {upcoming.length > 1 && (
                        <span className="ml-1.5 font-semibold text-[var(--fg-faint)]">
                          +{upcoming.length - 1} more
                        </span>
                      )}
                    </p>
                    <QueueRow song={upcoming[0]} onPlay={() => play(upcoming[0]!, upcoming)} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/*
          The phone's controls, under the player.

          A sibling of the video rather than a wrapper around it: the iframe
          must keep its place in the tree, because a re-parented iframe reloads
          and playback stops. `xl:hidden` because from that width up the queue
          panel is beside the video and the desktop bar already carries the
          transport.
        */}
        {expanded && (
          <div className="xl:hidden">
            <MobileTransport />
          </div>
        )}
      </div>
    </aside>
  );
}
