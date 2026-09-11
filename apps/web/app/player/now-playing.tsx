"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

import { ArtistLink } from "../artist-link";

import { Artwork } from "../artwork";
import { formatDuration } from "../duration";
import { ChevronIcon, CloseIcon, CollapseIcon, ExpandIcon, ExternalIcon, PlayIcon } from "../icons";
import { sourceStyle } from "../sources";
import type { Song } from "../types";
import { ArtistCard } from "./artist-card";
import { usePlayerControls } from "./player-context";
import { SimilarSongs } from "./similar-songs";
import { PanelTabs } from "./panel-tabs";
import { usePlaybackPrefs } from "./playback-prefs";
import { QueueSearch } from "./queue-search";
import { useSongMenu } from "./song-menu";
import { YouTubePlayer } from "./youtube-player";

// Fetched when first shown: this panel is in the root shell, so a static import
// ships everywhere. YouTube stays static because it must not wait on a fetch.
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

/** A queued song. A container with a button inside rather than one big button: a button
 * cannot legally hold another, so browsers drop the inner control and screen readers
 * announce one unlabelled target. */
export function QueueRow({
  song,
  onPlay,
  actions,
  playOverlay = false,
  label,
}: {
  song: Song;
  onPlay: () => void;
  actions?: ReactNode;
  /** Hover play wash over the artwork, and the "Play …" label that goes with advertising one.
   * Opt-in: a queue already reads as a running order, so Related asks for it and Up Next does not. */
  playOverlay?: boolean;
  /** Overrides the row's accessible name, for a list where the row does something other than
   * play — the queue search adds, and "Song, Artist" alone would not say so. */
  label?: string;
}) {
  // The same right-click menu the page's rows have. Worth having here too: this is where
  // someone looks at what is coming and decides one of it should come sooner.
  const { onContextMenu, menu } = useSongMenu(song);

  return (
    <div
      onContextMenu={onContextMenu}
      className="group/row flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 hover:bg-[var(--surface-2)]"
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus:outline-none"
        aria-label={label ?? (playOverlay ? `Play ${song.title}` : undefined)}
      >
        <span className="relative shrink-0">
          <Artwork
            src={song.artworkUrl}
            className="slab-sm size-10 rounded-[var(--r-sm)]"
            iconClassName="size-4"
          />
          {playOverlay && (
            <span className="absolute inset-0 flex items-center justify-center rounded-[var(--r-sm)] bg-black/55 opacity-0 transition group-hover/row:opacity-100">
              <PlayIcon className="size-4 text-white" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{song.title}</span>
          <span className="block truncate text-[11px] text-[var(--fg-dim)]">
            <ArtistLink artists={song?.artists ?? []} />
          </span>
        </span>
      </button>
      {actions}
      {menu}
    </div>
  );
}

// Reorder and remove, for one queued row. Hidden until hover or `focus-within` — not
// `focus`, or tabbing between the controls would make each vanish as you reach the next.
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
 * The now-playing panel — the video, the current track, and what is coming up. Three
 * shapes, **one element**: a floating card on a phone, a column on desktop, and theater,
 * all the same DOM restyled. That is a requirement, not a shortcut — rendering the player
 * elsewhere per shape re-parents its iframe, and a re-parented iframe reloads.
 */
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
    theater,
    toggleTheater,
    queue,
    index,
    radio,
    play,
    move,
    removeAt,
    clearQueue,
  } = usePlayerControls();
  const { continueWithRadio } = usePlaybackPrefs();

  const active = current !== null;
  const open = active && panelOpen;
  const expanded = open && theater;

  // The queue, then the blend it steps into when that runs out — the queue alone said
  // "nothing after this one" with recommendations already fetched a track away. Not when
  // Settings stops the queue at its end: listing songs that will never play is the same lie.
  const queued = queue.slice(index + 1);
  const known = new Set(queue.map((song) => song.id));
  const suggested = continueWithRadio ? radio.filter((song) => !known.has(song.id)) : [];
  const upcoming = [...queued, ...suggested];

  // Where to send someone whose track will not play here. The song's own most-playable
  // source first — `sources` is already ordered that way — because a track that exists only
  // on Audius or the archive is not on YouTube, and offering a YouTube search for it is a
  // dead end dressed as a way out. The search is the last resort, for a song whose sources
  // publish no page at all.
  const elsewhereUrl =
    current?.sources.find((item) => item.url)?.url ??
    (current
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
          [current.title, current.artists[0]].filter(Boolean).join(" "),
        )}`
      : null);

  // Widths are explicit, never `w-full`: closing collapses the *outer* box to zero and
  // clips while the card keeps its real size, which is what holds the player above
  // 200×200 while hidden. A percentage width would take playback with it.
  // Sources Timbre plays itself have no picture to keep on screen. The floating card exists
  // because YouTube's IFrame API must stay visible and stops below 200×200 — a compliance
  // floor, not a layout preference — and the SoundCloud widget is a real embed too. An
  // `<audio>` element is neither, so on a phone the card was 300×200 of cover art parked
  // over the results, showing a still the player bar already carries as a thumbnail.
  //
  // Hidden below `xl` in that case only. `display:none` does not pause a media element the
  // way re-parenting one would, so the player stays mounted and playing; the queue panel is
  // already `xl`-only for the same reason, so nothing else is lost on a phone.
  // Spotify's embed and Mixcloud's widget are both somebody else's chrome and both have to
  // stay visible — Mixcloud's licence says so outright — so unlike an `<audio>` element they
  // stay on a phone. Only the sources with no picture at all collapse.
  const audioOnly = Boolean(streamUrl);

  const shell = expanded
    ? "flex min-h-0 min-w-0 flex-1 p-2 lg:pl-0"
    : // Both offsets carry the safe-area insets themselves. `position: fixed` resolves
      // against the viewport, not the padded <body>, so the horizontal inset applied there
      // does not reach this card — in landscape it parked under the notch ear — and the
      // bars it clears are each taller than their `--*-h` by the bottom inset.
      `fixed bottom-[calc(var(--bar-h)+var(--nav-h)+var(--safe-b)+0.75rem)] right-[calc(0.75rem+var(--safe-r))] z-40 transition-all duration-300 ease-[var(--ease)] lg:bottom-[calc(var(--bar-h)+var(--safe-b)+0.75rem)] xl:static xl:z-auto xl:shrink-0 xl:overflow-hidden xl:p-2 xl:pl-0 xl:transition-[width] ${
        audioOnly ? "hidden xl:block" : ""
      } ${
        open
          ? "translate-y-0 opacity-100 xl:w-[23rem]"
          : "pointer-events-none translate-y-3 opacity-0 xl:w-0 xl:p-0"
      }`;

  const card = expanded
    ? "flex min-h-0 w-full flex-1 flex-col gap-2 xl:flex-row"
    : // The ceiling counts the landscape ears, for the same reason the offsets above do:
      // the card's ancestor is `position: fixed`, so the `body` padding that insets
      // everything else never reaches it and `100dvw` here is the whole screen, notch
      // included. Portrait with no insets computes exactly what it always did, so the
      // 200px floor the YouTube embed needs (docs/BUGS.md B-1) is untouched — 320px is
      // the narrowest phone there is and still leaves 296.
      "slab flex w-[19rem] max-w-[calc(100dvw-1.5rem-var(--safe-l)-var(--safe-r))] flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:h-full xl:w-[22.5rem] xl:max-w-none";

  // `min-h-[200px]` is a compliance floor: YouTube's IFrame API refuses to play below
  // 200×200, reporting only "Video unavailable" (docs/BUGS.md B-1), and `aspect-video` on
  // a 320px-wide phone computes 171px.
  const videoBox = expanded
    ? "slab relative min-h-[200px] w-full shrink-0 overflow-hidden rounded-[var(--r-lg)] bg-black aspect-video xl:aspect-auto xl:h-full xl:min-h-0 xl:w-auto xl:min-w-0 xl:shrink xl:flex-1"
    : "relative shrink-0 bg-black";

  const listBox = expanded
    ? // Below `xl` the queue is hidden and the transport takes the slot instead.
      "slab hidden min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:flex xl:h-full xl:w-[21rem] xl:flex-none"
    : // Docked on a phone the floating card is the video and nothing else.
      "hidden min-h-0 flex-1 flex-col xl:flex";

  // `inert` alongside `aria-hidden`: neither the closed styles nor `aria-hidden` take this
  // panel's buttons out of the tab order, so focus used to land in an invisible column. Still
  // never unmounted — that re-parents the iframe and playback stops.
  return (
    <aside className={shell} aria-hidden={!open} inert={!open} aria-label="Now playing">
      <div className={card}>
        <div className={videoBox}>
          {/* Embedding barred by the rights holder cannot be worked around. */}
          {state === "unplayable" && elsewhereUrl && (
            <a
              href={elsewhereUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-[var(--surface-2)] px-3 py-2.5 text-xs font-medium text-[var(--fg)] transition hover:text-[var(--accent)]"
            >
              {problem ?? "Can't play this here"}
              <ExternalIcon className="size-3" />
            </a>
          )}

          {/* Sits *over* the player, which takes no pointer input at all — that is what
              stops YouTube painting its own hover overlay across the video. */}
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

          {/* One player mounted at a time: a torn-down one cannot be restarted by a
              stray event during handoff. */}
          {activeSource === "soundcloud" ? (
            <SoundCloudPlayer
              trackUrl={soundcloudUrl}
              artworkUrl={current?.artworkUrl ?? null}
              expanded={expanded}
              // Docked, the box is exactly the widget — nothing else is drawn there.
              size={expanded ? "h-full w-full" : "h-[166px] w-full"}
            />
          ) : mixcloudKey ? (
            <MixcloudPlayer
              cloudcastKey={mixcloudKey}
              artworkUrl={current?.artworkUrl ?? null}
              // The card spends 94px on padding, gap and the widget, so 280 leaves the cover
              // 186 — the size it was mocked at, and still the largest this panel can give it
              // without pushing what sits below it off the shelf.
              size={expanded ? "h-full w-full" : "h-[280px] w-full"}
            />
          ) : spotifyTrackId ? (
            <SpotifyPlayer
              trackId={spotifyTrackId}
              size={expanded ? "h-full w-full" : "h-[200px] w-full"}
            />
          ) : subscriptionTrack ? (
            // Apple's and Deezer's own players, reached only when the reader names them —
            // the whole song for a subscriber, a clip for everyone else. See
            // `subscription-player.tsx`; Deezer's widget is the taller of the two.
            <SubscriptionPlayer
              track={subscriptionTrack}
              size={
                expanded
                  ? "h-full w-full"
                  : subscriptionTrack.source === "deezer"
                    ? "h-[300px] w-full"
                    : "h-[200px] w-full"
              }
            />
          ) : streamUrl ? (
            <ProgressiveAudioPlayer
              streamUrl={streamUrl}
              artworkUrl={current?.artworkUrl ?? null}
              artworkFallbacks={current?.artworkFallbacks}
              title={current?.title}
              size={expanded ? "h-full w-full" : "h-[200px] w-full"}
            />
          ) : (
            <YouTubePlayer size={expanded ? "h-full w-full" : "h-[200px] w-full"} />
          )}
        </div>

        {/* Only this subtree swaps — the video is a sibling and keeps its place in the
            tree, so it never reloads. */}
        <div className={listBox}>
          {expanded ? (
            <>
              {/* No source name here. Attribution is a terms requirement for every service
                  Timbre embeds, and it is met by the transport — `PlayerBar` renders
                  whenever anything is playing (`app-shell.tsx`), and its source label is the
                  copyable one. Naming it twice on the same screen was noise, not compliance.
                  If the bar ever becomes conditional, this has to come back. */}
              <div className="flex items-start gap-3 border-b-[length:var(--edge)] border-[var(--ink)] px-4 pb-3 pt-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{current?.title ?? "Nothing playing"}</p>
                  <p className="truncate text-xs text-[var(--fg-dim)]">
                    <ArtistLink artists={current?.artists ?? []} />
                  </p>
                </div>
              </div>

              {/* The queue stays here; in <PanelTabs> two places would have an opinion
                  about what plays next. */}
              <PanelTabs
                queue={
                  <QueueSearch>
                  <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                    <span className="text-[11px] tabular-nums text-[var(--fg-faint)]">
                      {upcoming.length || ""} coming up
                    </span>
                    {/* Queued songs only — suggestions are what plays if nothing is. */}
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
                          // Only the queued half is editable: suggestions are refetched
                          // per track change, so "remove" visibly would not work.
                          const queuedHere = position < queued.length;
                          const at = index + 1 + position;
                          const last = index + queued.length;

                          return (
                            <li key={`${song.id}-${position}`}>
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
                                      // Never above the playing song: the queue behind
                                      // `index` is history, and a track promoted into
                                      // it is silently dropped.
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
                  </QueueSearch>
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
                </div>

                <ArtistCard name={current?.artists[0] ?? null} />

                {current && (
                  <section className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5">
                    <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
                      Credits
                    </h3>
                    {/* Only what the sources publish — no free catalogue has writers. */}
                    <dl className="space-y-1 text-[11px]">
                      <Credit label="Performed by" value={current.artists.join(", ") || null} />
                      <Credit label="Album" value={current.album} />
                      {/* Not `formatDuration(null)`'s em dash: an unreported length drops
                          the row rather than printing a placeholder. */}
                      <Credit
                        label="Length"
                        value={current.durationMs === null ? null : formatDuration(current.durationMs)}
                      />
                      <Credit label="ISRC" value={current.isrc} mono />
                      <Credit
                        label="Available on"
                        value={current.sources.map((item) => sourceStyle(item.source).short).join(", ")}
                      />
                    </dl>
                  </section>
                )}

                <SpotifyPanel song={current} />

                <SimilarSongs />

                {/* Inside the scroll area, not pinned below it: pinned, it clipped the
                    credits list mid-line with nothing to say more existed. */}
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

        {/* A sibling of the video, never a wrapper: a re-parented iframe reloads. */}
        {expanded && (
          <div className="xl:hidden">
            <MobileTransport />
          </div>
        )}
      </div>
    </aside>
  );
}
