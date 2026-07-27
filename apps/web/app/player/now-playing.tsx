"use client";

import { CollapseIcon, ExpandIcon, ExternalIcon, NoteIcon } from "../icons";
import { sourceStyle } from "../sources";
import { usePlayer } from "./player-context";
import { SoundCloudPlayer } from "./soundcloud-player";
import { YouTubePlayer } from "./youtube-player";

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
    play,
  } = usePlayer();

  const active = current !== null;
  const open = active && panelOpen;
  const expanded = open && theater;
  const upcoming = queue.slice(index + 1);
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
  const shell = expanded
    ? "flex min-h-0 min-w-0 flex-1 p-2 lg:pl-0"
    : `fixed bottom-[calc(var(--bar-h)+var(--nav-h)+0.75rem)] right-3 z-40 transition-all duration-300 ease-[var(--ease)] lg:static lg:z-auto lg:shrink-0 lg:overflow-hidden lg:p-2 lg:pl-0 lg:transition-[width] ${
        open
          ? "translate-y-0 opacity-100 lg:w-[23rem]"
          : "pointer-events-none translate-y-3 opacity-0 lg:w-0 lg:p-0"
      }`;

  const card = expanded
    ? "flex min-h-0 w-full flex-1 flex-col gap-2 lg:flex-row"
    : "slab flex w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] lg:h-full lg:w-[22.5rem] lg:max-w-none";

  /*
   * Expanded, the box is 16:9 and centred rather than filling the area. A box
   * of any other shape still *works* — YouTube letterboxes inside whatever it
   * is given — but then the black bars sit inside the panel border, which reads
   * as a broken layout rather than as a video.
   */
  const videoBox = expanded
    ? "slab relative aspect-video max-h-full w-full shrink-0 self-center overflow-hidden rounded-[var(--r-lg)] bg-black lg:w-auto lg:min-w-0 lg:shrink lg:flex-1"
    : "relative shrink-0 bg-black";

  const listBox = expanded
    ? "slab flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-1)] lg:h-full lg:w-[24rem] lg:flex-none"
    : // On a phone the floating card is the video and nothing else — there is no
      // room for a queue beside a mini player, and the theater view is one tap
      // away for anyone who wants one.
      "hidden min-h-0 flex-1 flex-col lg:flex";

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

        <div className={listBox}>
          <div
            className={`flex items-start gap-3 px-4 pb-3 pt-3.5 ${
              expanded ? "border-b-[length:var(--edge)] border-[var(--ink)]" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{current?.title ?? "Nothing playing"}</p>
              <p className="truncate text-xs text-[var(--fg-dim)]">
                {current?.artists.join(", ") || "Unknown artist"}
              </p>
              {current?.album && (
                <p className="truncate text-[11px] text-[var(--fg-faint)]">{current.album}</p>
              )}
            </div>
            {/* Attribution names the source actually playing. Every service
                Timbre embeds requires it, and it is the only way to tell whose
                player you are hearing. */}
            <span
              className="mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
              style={{ color: source.color, backgroundColor: source.tint }}
            >
              {source.short}
            </span>
          </div>

          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
              Up next
            </span>
            <span className="text-[11px] tabular-nums text-[var(--fg-faint)]">
              {upcoming.length || ""}
            </span>
          </div>

          <div className="scroller min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {upcoming.length === 0 ? (
              <p className="px-2 py-4 text-xs leading-relaxed text-[var(--fg-faint)]">
                Nothing after this one. Playing a song from a shelf queues the rest of it.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {upcoming.map((song, position) => (
                  <li key={`${song.id}-${position}`}>
                    <button
                      type="button"
                      onClick={() => play(song, queue)}
                      className="flex w-full items-center gap-2.5 rounded-[var(--r-md)] p-1.5 text-left hover:bg-[var(--surface-2)]"
                    >
                      <span className="slab-sm size-10 shrink-0 overflow-hidden rounded-[var(--r-sm)] bg-[var(--surface-2)]">
                        {song.artworkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                          <img
                            src={song.artworkUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center text-[var(--fg-faint)]">
                            <NoteIcon className="size-4" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">
                          {song.title}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--fg-dim)]">
                          {song.artists.join(", ") || "Unknown artist"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
