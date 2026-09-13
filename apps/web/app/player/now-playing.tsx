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
  playOverlay = false,
  label,
}: {
  song: Song;
  onPlay: () => void;
  actions?: ReactNode;
  playOverlay?: boolean;
  label?: string;
}) {
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
            <ArtistLink artists={song.artists} />
          </span>
        </span>
      </button>
      {actions}
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

  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-0.5 opacity-0 transition group-hover/row:opacity-100 group-focus-within/row:opacity-100">
      {actions.map(({ label, onClick, icon }) => (
        <button
          key={label}
          type="button"
          onClick={onClick ?? undefined}
          disabled={!onClick}
          aria-label={label}
          className="flex size-6 items-center justify-center rounded-[var(--r-sm)] text-[var(--fg-dim)] transition hover:bg-[var(--surface-3)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-25"
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

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
    goTo,
    move,
    removeAt,
    clearQueue,
  } = usePlayerControls();
  const { continueWithRadio } = usePlaybackPrefs();

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

  const shell = expanded
    ? "flex min-h-0 min-w-0 flex-1 p-2 lg:pl-0"
    : `fixed bottom-[calc(var(--bar-h)+var(--nav-h)+var(--safe-b)+0.75rem)] right-[calc(0.75rem+var(--safe-r))] z-40 transition-all duration-300 ease-[var(--ease)] lg:bottom-[calc(var(--bar-h)+var(--safe-b)+0.75rem)] xl:static xl:z-auto xl:shrink-0 xl:overflow-hidden xl:p-2 xl:pl-0 xl:transition-[width] ${
        streamUrl ? "hidden xl:block" : ""
      } ${
        open
          ? "translate-y-0 opacity-100 xl:w-[23rem]"
          : "pointer-events-none translate-y-3 opacity-0 xl:w-0 xl:p-0"
      }`;

  const card = expanded
    ? "flex min-h-0 w-full flex-1 flex-col gap-2 xl:flex-row"
    : "slab flex w-[19rem] max-w-[calc(100dvw-1.5rem-var(--safe-l)-var(--safe-r))] flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:h-full xl:w-[22.5rem] xl:max-w-none";

  const videoBox = expanded
    ? "slab relative min-h-[200px] w-full shrink-0 overflow-hidden rounded-[var(--r-lg)] bg-black aspect-video xl:aspect-auto xl:h-full xl:min-h-0 xl:w-auto xl:min-w-0 xl:shrink xl:flex-1"
    : "relative shrink-0 bg-black";

  const size = (docked: string) => (expanded ? "h-full w-full" : `${docked} w-full`);
  const artworkUrl = current?.artworkUrl ?? null;

  const listBox = expanded
    ? "slab hidden min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:flex xl:h-full xl:w-[21rem] xl:flex-none"
    : "hidden min-h-0 flex-1 flex-col xl:flex";

  const heading = (title: string, box?: string) => (
    <div className={box}>
      <p className={`truncate ${title}`}>{current?.title ?? "Nothing playing"}</p>
      <p className="truncate text-xs text-[var(--fg-dim)]">
        <ArtistLink artists={current?.artists ?? []} />
      </p>
    </div>
  );

  return (
    <aside className={shell} aria-hidden={!open} inert={!open} aria-label="Now playing">
      <div className={card}>
        <div className={videoBox}>
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
              {heading(
                "text-sm font-bold",
                "border-b-[length:var(--edge)] border-[var(--ink)] px-4 pb-3 pt-3.5",
              )}
              <PanelTabs
                queue={
                  <QueueSearch>
                    <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                      <span className="text-[11px] tabular-nums text-[var(--fg-faint)]">
                        {upcoming.length || ""} coming up
                      </span>
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
                            const at = index + 1 + position;
                            return (
                              <li key={`${song.id}-${position}`}>
                                {position === queued.length && (
                                  <p className="px-1.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--fg-faint)]">
                                    Then, from your blend
                                  </p>
                                )}
                                <QueueRow
                                  song={song}
                                  onPlay={() => startFrom(song, position)}
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
            <div className="scroller-quiet min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {heading("text-[15px] font-extrabold leading-tight")}
              <ArtistCard name={current?.artists[0] ?? null} />

              {current && (
                <section className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5">
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
                    Credits
                  </h3>
                  <dl className="space-y-1 text-[11px]">
                    <Credit label="Performed by" value={current.artists.join(", ") || null} />
                    <Credit label="Album" value={current.album} />
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
                  <QueueRow song={upcoming[0]} onPlay={() => startFrom(upcoming[0]!, 0)} />
                </div>
              )}
            </div>
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
