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
            <ArtistLink artists={song?.artists ?? []} />
          </span>
        </span>
      </button>
      {actions}
      {menu}
    </div>
  );
}

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

  const queued = queue.slice(index + 1);
  const known = new Set(queue.map((song) => song.id));
  const suggested = continueWithRadio ? radio.filter((song) => !known.has(song.id)) : [];
  const upcoming = [...queued, ...suggested];

  const elsewhereUrl =
    current?.sources.find((item) => item.url)?.url ??
    (current
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
          [current.title, current.artists[0]].filter(Boolean).join(" "),
        )}`
      : null);

  const audioOnly = Boolean(streamUrl);

  const shell = expanded
    ? "flex min-h-0 min-w-0 flex-1 p-2 lg:pl-0"
    : `fixed bottom-[calc(var(--bar-h)+var(--nav-h)+var(--safe-b)+0.75rem)] right-[calc(0.75rem+var(--safe-r))] z-40 transition-all duration-300 ease-[var(--ease)] lg:bottom-[calc(var(--bar-h)+var(--safe-b)+0.75rem)] xl:static xl:z-auto xl:shrink-0 xl:overflow-hidden xl:p-2 xl:pl-0 xl:transition-[width] ${
        audioOnly ? "hidden xl:block" : ""
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

  const listBox = expanded
    ? "slab hidden min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] xl:flex xl:h-full xl:w-[21rem] xl:flex-none"
    : "hidden min-h-0 flex-1 flex-col xl:flex";

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
              {expanded ? (
                <CollapseIcon className="size-4" />
              ) : (
                <ExpandIcon className="size-4" />
              )}
            </span>
          </button>

          {activeSource === "soundcloud" ? (
            <SoundCloudPlayer
              trackUrl={soundcloudUrl}
              artworkUrl={current?.artworkUrl ?? null}
              expanded={expanded}
              size={expanded ? "h-full w-full" : "h-[166px] w-full"}
            />
          ) : mixcloudKey ? (
            <MixcloudPlayer
              cloudcastKey={mixcloudKey}
              artworkUrl={current?.artworkUrl ?? null}
              size={expanded ? "h-full w-full" : "h-[280px] w-full"}
            />
          ) : spotifyTrackId ? (
            <SpotifyPlayer
              trackId={spotifyTrackId}
              size={expanded ? "h-full w-full" : "h-[200px] w-full"}
            />
          ) : subscriptionTrack ? (
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
              </div>

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
                    <QueueRow song={upcoming[0]} onPlay={() => play(upcoming[0]!, upcoming)} />
                  </div>
                )}
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
