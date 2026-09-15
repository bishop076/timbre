"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { moveBetweenItems } from "../a11y/arrow-nav";
import { ArtistLink } from "../artist-link";
import { Artwork } from "../artwork";
import { formatDuration } from "../duration";
import { Equalizer } from "../equalizer";
import { ChevronIcon, CloseIcon, CollapseIcon, ExpandIcon, ExternalIcon, PlayIcon } from "../icons";
import { EYEBROW } from "../page-chrome";
import { usePanelWidth } from "../shell/pane-size.ts";
import { sourceStyle } from "../sources";
import type { Song } from "../types";
import { ArtistCard } from "./artist-card";
import { usePlayerControls } from "./player-context";
import { PanelTabs } from "./panel-tabs";
import { usePlaybackPrefs } from "./playback-prefs";
import { QueueSearch } from "./queue-search";
import { SimilarSongs } from "./similar-songs";
import { useSongMenu } from "./song-menu";
import { YouTubePlayer } from "./youtube-player";

const SoundCloudPlayer = dynamic(() =>
  import("./soundcloud-player").then((m) => m.SoundCloudPlayer),
);
const ProgressiveAudioPlayer = dynamic(() =>
  import("./progressive-audio-player").then((m) => m.ProgressiveAudioPlayer),
);
const SpotifyPlayer = dynamic(() => import("./spotify-player").then((m) => m.SpotifyPlayer));
const SubscriptionPlayer = dynamic(() =>
  import("./subscription-player").then((m) => m.SubscriptionPlayer),
);
const SpotifyPanel = dynamic(() => import("./spotify-panel").then((m) => m.SpotifyPanel));
const MixcloudPlayer = dynamic(() => import("./mixcloud-player").then((m) => m.MixcloudPlayer));
const MobileTransport = dynamic(() => import("./mobile-transport").then((m) => m.MobileTransport));

function Credit({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-[var(--fg-faint)]">{label}</dt>
      <dd className={`min-w-0 flex-1 truncate ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd>
    </div>
  );
}

export function QueueRow({
  song,
  onPlay,
  actions,
  floatActions = false,
  playOverlay = false,
  label,
}: {
  song: Song;
  onPlay: () => void;
  actions?: ReactNode;
  /** Take `actions` out of the row's flow. For a cluster that is only visible on hover and
   *  carries its own opaque fill; an always-visible control still wants the reserved slot. */
  floatActions?: boolean;
  playOverlay?: boolean;
  label?: string;
}) {
  const { onContextMenu, menu } = useSongMenu(song);

  // Same shape as a search-result row, and fixed the same way: the play button covers the line
  // rather than wrapping it, because the artist link inside it is a link, and a link inside a
  // button is discarded from the accessibility tree along with anything else in there. The label
  // is now unconditional — the button no longer has any text of its own to be named by.
  //
  // Dense on purpose: 36px artwork on 4px padding is a 44px line, against the 52px the 40px/6px
  // version cost. On a 690px-tall window that is two more tracks visible in the queue.
  return (
    <div
      onContextMenu={onContextMenu}
      className="group/row relative flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-1.5 py-1 transition-colors hover:bg-[var(--surface-2)]"
    >
      <button
        type="button"
        onClick={onPlay}
        className="absolute inset-0 z-0 rounded-[var(--r-sm)]"
        aria-label={label ?? `Play ${song.title}`}
      />

      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="relative shrink-0">
          <Artwork
            src={song.artworkUrl}
            className="slab-sm size-9 rounded-[var(--r-sm)]"
            iconClassName="size-4"
          />
          {playOverlay && (
            <span className="absolute inset-0 flex items-center justify-center rounded-[var(--r-sm)] bg-black/55 opacity-0 transition-opacity group-hover/row:opacity-100">
              <PlayIcon className="size-4 text-white" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--text-meta)] font-semibold tracking-[var(--track-body)]">
            {song.title}
          </span>
          <span className="block truncate text-[11px] text-[var(--fg-dim)]">
            <ArtistLink artists={song.artists} />
          </span>
        </span>
      </div>
      {actions &&
        (floatActions ? actions : <span className="relative z-10 shrink-0">{actions}</span>)}
      {menu}
    </div>
  );
}

/** The one row that is not a destination: what is playing right now, pinned above the list so
 * "now" and "next" are never the same shape. It deliberately has no play button — clicking the
 * thing that is already playing is the classic queue-panel mis-tap. */
function NowPlayingRow({ song, playing }: { song: Song; playing: boolean }) {
  const { onContextMenu, menu } = useSongMenu(song);

  return (
    <div
      onContextMenu={onContextMenu}
      aria-current="true"
      className="slab-sm tint flex items-center gap-2.5 rounded-[var(--r-md)] px-1.5 py-1"
      style={{ background: "var(--accent-wash)" }}
    >
      <Artwork
        src={song.artworkUrl}
        className="slab-sm size-9 shrink-0 rounded-[var(--r-sm)]"
        iconClassName="size-4"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[length:var(--text-meta)] font-semibold tracking-[var(--track-body)]">
          {song.title}
        </p>
        <p className="truncate text-[11px] text-[var(--fg-dim)]">
          <ArtistLink artists={song.artists} />
        </p>
      </div>
      {playing && (
        <Equalizer className="tint h-3.5 shrink-0 gap-[3px] pr-1 text-[var(--accent-text)]" />
      )}
      {menu}
    </div>
  );
}

function QueueActions({
  title,
  onUp,
  onDown,
  onRemove,
}: {
  title: string;
  onUp: (() => void) | null;
  onDown: (() => void) | null;
  onRemove: () => void;
}) {
  const actions = [
    {
      label: `Move ${title} up`,
      onClick: onUp,
      icon: <ChevronIcon className="size-3.5 rotate-180" />,
    },
    { label: `Move ${title} down`, onClick: onDown, icon: <ChevronIcon className="size-3.5" /> },
    { label: `Remove ${title}`, onClick: onRemove, icon: <CloseIcon className="size-3.5" /> },
  ];

  // One grouped pill rather than three loose glyphs, so the row reads as something you can
  // re-order rather than three unrelated icons.
  //
  // It floats over the end of the row instead of sitting in the flow. Reserving 83px for a control
  // that is invisible most of the time left the title 166px of a 333px column, and anything past
  // "Paranoid Android" was ellipsis; taking it out of the flow gives that width back and still
  // cannot reflow the title, because an absolutely positioned box has no width to give. It carries
  // its own opaque fill so the tail of a long title reads as covered rather than as a collision.
  return (
    <div className="slab-sm absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-[var(--r-full)] bg-[var(--surface-1)] p-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100">
      {actions.map(({ label, onClick, icon }) => (
        <button
          key={label}
          type="button"
          onClick={onClick ?? undefined}
          disabled={!onClick}
          aria-label={label}
          className="flex size-6 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-25"
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/** How much of the queue the docked panel shows before it defers to the theater view. Three rows
 * is what fits under the credits on a 690px-tall window without pushing anything off. */
const DOCKED_QUEUE = 3;

/** The panel's own id, so the separator in `app-shell.tsx` can name it in `aria-controls` and
 *  find it to paint a width onto while it is being dragged. */
export const NOW_PLAYING_ID = "now-playing-panel";

export function NowPlayingPanel() {
  const {
    current,
    state,
    problem,
    activeSource,
    soundcloudUrl,
    streamUrl,
    spotifyTrackId,
    subscriptionTrack,
    mixcloudKey,
    panelOpen,
    togglePanel,
    theater,
    toggleTheater,
    queue,
    index,
    radio,
    play,
    goTo,
    move,
    removeAt,
    clearQueue,
  } = usePlayerControls();
  const { continueWithRadio } = usePlaybackPrefs();
  const width = usePanelWidth();

  const open = current !== null && panelOpen;
  const expanded = open && theater;

  const queued = queue.slice(index + 1);
  const last = queued.length - 1;

  // A row already in the queue is a seek, not a new queue. `play(song, upcoming)` rebuilt the
  // queue as [song, ...rest], discarding the playing song and everything before it: Previous
  // greyed out for good, the play history was gone, and `play`'s fourth argument being absent
  // cleared `queueOrigin`, so the playlist it came from stopped showing as active. Rows past
  // the queue are blend picks with no index to seek to, so those still start a queue.
  const startFrom = (song: Song, position: number) =>
    position < queued.length ? goTo(index + 1 + position) : play(song, upcoming);
  const known = new Set(queue.map((song) => song.id));
  const upcoming = [
    ...queued,
    ...(continueWithRadio ? radio.filter((song) => !known.has(song.id)) : []),
  ];

  const elsewhereUrl =
    current?.sources.find((item) => item.url)?.url ??
    (current
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
          [current.title, current.artists[0]].filter(Boolean).join(" "),
        )}`
      : null);

  // Docked, the width is whatever the handle on its left edge last committed — read from a custom
  // property rather than a React value so a drag can repaint it without re-rendering the queue.
  // `23rem` is the fallback the server paints with, which is the width this panel always had.
  //
  // `transition-[width]` is for opening and closing; during a drag it is 300ms of lag, so the
  // root's `data-resizing` turns it off. The attribute selector outranks the media query, which
  // is why there is no `!` on it.
  const shell = expanded
    ? "flex min-h-0 min-w-0 flex-1 p-2 lg:pl-0"
    : `fixed bottom-[calc(var(--bar-h)+var(--nav-h)+var(--safe-b)+0.75rem)] right-[calc(0.75rem+var(--safe-r))] z-40 transition-all duration-300 ease-[var(--ease)] lg:bottom-[calc(var(--bar-h)+var(--safe-b)+0.75rem)] xl:static xl:z-auto xl:shrink-0 xl:overflow-hidden xl:p-2 xl:pl-0 xl:transition-[width] [[data-resizing]_&]:transition-none ${
        streamUrl ? "hidden xl:block" : ""
      } ${
        open
          ? "translate-y-0 opacity-100 xl:w-[var(--np-w,23rem)]"
          : "pointer-events-none translate-y-3 opacity-0 xl:w-0 xl:p-0"
      }`;

  const card = expanded
    ? "flex min-h-0 w-full flex-1 flex-col gap-2 xl:flex-row"
    : "slab flex w-[19rem] max-w-[calc(100dvw-1.5rem-var(--safe-l)-var(--safe-r))] flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:h-full xl:w-full xl:max-w-none";

  const videoBox = expanded
    ? "slab relative min-h-[200px] w-full shrink-0 overflow-hidden rounded-[var(--r-lg)] bg-black aspect-video xl:aspect-auto xl:h-full xl:min-h-0 xl:w-auto xl:min-w-0 xl:shrink xl:flex-1"
    : "relative shrink-0 bg-black";

  const size = (docked: string) => (expanded ? "h-full w-full" : `${docked} w-full`);
  const artworkUrl = current?.artworkUrl ?? null;

  const listBox = expanded
    ? "slab hidden min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:flex xl:h-full xl:w-[21rem] xl:flex-none"
    : "hidden min-h-0 flex-1 flex-col xl:flex";

  // Artwork sits directly above this in both layouts, so the header carries title then artist and
  // no third copy of the cover. It is pinned outside the scroller now: it used to be the first
  // thing in the scrolling column, so scrolling the panel took the name of the song with it.
  //
  // `line-clamp-2` rather than `truncate`: at 22.5rem a remix title lost everything after the
  // opening bracket, and two lines costs ~22px against knowing what is playing.
  const heading = (variant: "docked" | "theater") => (
    <div
      className={`relative shrink-0 border-b-[length:var(--edge)] border-[var(--ink)] px-3.5 pb-2.5 ${
        variant === "docked" ? "pt-3" : "pt-3.5"
      }`}
    >
      {/* The panel's own way out. Dragging the edge away works and is the nicer gesture, but a
          gesture is not discoverable and cannot be reached from a keyboard without knowing the
          handle is there. The player bar's button only ever opens now, so this is the close. */}
      {variant === "docked" ? (
        <button
          type="button"
          onClick={togglePanel}
          aria-label="Hide now playing"
          title="Hide now playing"
          className="press absolute right-2 top-2 flex size-7 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
        >
          <ChevronIcon className="size-4 -rotate-90" />
        </button>
      ) : null}
      <p
        className={`line-clamp-2 font-bold tracking-[var(--track-title)] ${
          variant === "docked"
            ? "text-[length:var(--text-section)] leading-tight"
            : "text-[length:var(--text-body)] leading-snug"
        }`}
      >
        {current?.title ?? "Nothing playing"}
      </p>
      {/* Only when there is a track. ArtistLink's own empty fallback is "Unknown artist", which
          is the right thing to say about a song whose credits are missing and the wrong thing to
          say about no song at all — the pair read "Nothing playing / Unknown artist". */}
      {current ? (
        <p className="truncate text-[length:var(--text-meta)] text-[var(--fg-dim)]">
          <ArtistLink artists={current.artists} />
        </p>
      ) : null}
    </div>
  );

  return (
    <aside
      id={NOW_PLAYING_ID}
      style={{ "--np-w": `${width}px` } as React.CSSProperties}
      className={shell}
      aria-hidden={!open}
      inert={!open}
      aria-label="Now playing"
    >
      <div className={card}>
        <div className={videoBox}>
          {state === "unplayable" && elsewhereUrl && (
            <a
              href={elsewhereUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-[var(--surface-2)] px-3 py-2.5 text-xs font-medium text-[var(--fg)] transition hover:text-[var(--accent-text)]"
            >
              {problem ?? "Can't play this here"}
              <ExternalIcon className="size-3" />
            </a>
          )}

          <button
            type="button"
            onClick={toggleTheater}
            aria-label={expanded ? "Shrink video" : "Expand video"}
            aria-pressed={expanded}
            className="group absolute inset-0 z-10 flex cursor-pointer items-start justify-end p-2 focus:outline-none"
          >
            <span className="slab-sm flex size-8 items-center justify-center rounded-[var(--r-sm)] bg-[var(--surface-1)] text-[var(--fg)] opacity-0 transition duration-200 ease-[var(--ease)] group-hover:opacity-100 group-focus-visible:opacity-100">
              {expanded ? <CollapseIcon className="size-4" /> : <ExpandIcon className="size-4" />}
            </span>
          </button>

          {activeSource === "soundcloud" ? (
            <SoundCloudPlayer
              trackUrl={soundcloudUrl}
              artworkUrl={artworkUrl}
              expanded={expanded}
              size={size("h-[166px]")}
            />
          ) : mixcloudKey ? (
            <MixcloudPlayer
              cloudcastKey={mixcloudKey}
              artworkUrl={artworkUrl}
              size={size("h-[280px]")}
            />
          ) : spotifyTrackId ? (
            <SpotifyPlayer trackId={spotifyTrackId} size={size("h-[200px]")} />
          ) : subscriptionTrack ? (
            <SubscriptionPlayer
              track={subscriptionTrack}
              size={size(subscriptionTrack.source === "deezer" ? "h-[300px]" : "h-[200px]")}
            />
          ) : streamUrl ? (
            <ProgressiveAudioPlayer
              streamUrl={streamUrl}
              artworkUrl={artworkUrl}
              artworkFallbacks={current?.artworkFallbacks}
              title={current?.title}
              size={size("h-[200px]")}
            />
          ) : (
            <YouTubePlayer size={size("h-[200px]")} />
          )}
        </div>

        <div className={listBox}>
          {expanded ? (
            <>
              {heading("theater")}
              <PanelTabs
                queue={
                  <QueueSearch>
                    {current && (
                      <div className="shrink-0 px-2 pb-2 pt-2">
                        <p className={`${EYEBROW} px-1.5 pb-1`}>Playing now</p>
                        <NowPlayingRow song={current} playing={state === "playing"} />
                      </div>
                    )}

                    <div className="flex shrink-0 items-center gap-2 border-t-[length:var(--edge)] border-[var(--ink)] px-3.5 pb-1.5 pt-2.5">
                      <p className={EYEBROW}>Next up</p>
                      {upcoming.length > 0 && (
                        <span className="rounded-[var(--r-full)] bg-[var(--surface-2)] px-1.5 text-[11px] font-semibold tabular-nums text-[var(--fg-dim)]">
                          {upcoming.length}
                        </span>
                      )}
                      {queued.length > 0 && (
                        <button
                          type="button"
                          onClick={clearQueue}
                          className="ml-auto rounded-[var(--r-full)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--fg-dim)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
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
                            const at = index + 1 + position;
                            return (
                              <li
                                key={`${song.id}-${position}`}
                                onKeyDown={(event) =>
                                  moveBetweenItems(
                                    event,
                                    event.currentTarget.parentElement,
                                    "vertical",
                                  )
                                }
                              >
                                {position === queued.length && (
                                  <p className="px-1.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--fg-faint)]">
                                    Then, from your blend
                                  </p>
                                )}
                                <QueueRow
                                  song={song}
                                  onPlay={() => startFrom(song, position)}
                                  playOverlay
                                  floatActions
                                  actions={
                                    position < queued.length ? (
                                      <QueueActions
                                        title={song.title}
                                        onUp={position > 0 ? () => move(at, at - 1) : null}
                                        onDown={position < last ? () => move(at, at + 1) : null}
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
                  </QueueSearch>
                }
              />
            </>
          ) : (
            <>
              {heading("docked")}
              <div className="scroller-quiet min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {upcoming.length > 0 && (
                  <section>
                    <div className="mb-1 flex items-center gap-2 px-1">
                      <h3 className={EYEBROW}>Next up</h3>
                      {upcoming.length > DOCKED_QUEUE && (
                        <span className="text-[11px] font-semibold text-[var(--fg-faint)]">
                          +{upcoming.length - DOCKED_QUEUE} more
                        </span>
                      )}
                    </div>
                    <ul className="flex flex-col gap-0.5">
                      {upcoming.slice(0, DOCKED_QUEUE).map((song, position) => (
                        <li
                          key={`${song.id}-${position}`}
                          onKeyDown={(event) =>
                            moveBetweenItems(event, event.currentTarget.parentElement, "vertical")
                          }
                        >
                          <QueueRow
                            song={song}
                            onPlay={() => startFrom(song, position)}
                            playOverlay
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {current && (
                  <section className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5">
                    <h3 className={`${EYEBROW} mb-1.5`}>Credits</h3>
                    <dl className="space-y-1 text-[11px]">
                      <Credit label="Performed by" value={current.artists.join(", ") || null} />
                      <Credit label="Album" value={current.album} />
                      <Credit
                        label="Length"
                        value={
                          current.durationMs === null ? null : formatDuration(current.durationMs)
                        }
                      />
                      <Credit label="ISRC" value={current.isrc} mono />
                      <Credit
                        label="Available on"
                        // Deduped by service: two copies of a track from one source would
                        // otherwise read "SoundCloud, SoundCloud". The CSV export already does
                        // this; this was the one place that did not.
                        value={[
                          ...new Set(current.sources.map((item) => sourceStyle(item.source).short)),
                        ].join(", ")}
                      />
                    </dl>
                  </section>
                )}

                <SpotifyPanel song={current} />

                <ArtistCard name={current?.artists[0] ?? null} />

                <SimilarSongs />
              </div>
            </>
          )}
        </div>

        {expanded && (
          <div className="xl:hidden">
            <MobileTransport />
          </div>
        )}
      </div>
    </aside>
  );
}
