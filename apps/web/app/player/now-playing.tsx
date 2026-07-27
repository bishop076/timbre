"use client";

import { ExternalIcon } from "../icons";
import { usePlayer } from "./player-context";
import { SoundCloudPlayer } from "./soundcloud-player";
import { YouTubePlayer } from "./youtube-player";

/**
 * The video surface.
 *
 * **It has no controls of its own.** Play, pause, seek, skip and even hiding
 * this panel all live in the player bar, so there is exactly one place that
 * acts on playback whether or not the current track happens to have pictures.
 * That is how Spotify handles tracks with video: the visual is a passive
 * surface, the transport never moves.
 *
 * It cannot be a thumbnail either. YouTube's IFrame API requires at least
 * 200×200 and fails below it with a bare "Video unavailable" — see docs/BUGS.md
 * B-1, which is what actually broke this app once. So hiding clips the panel
 * away at full size rather than shrinking it, and the player keeps its
 * dimensions the whole time.
 */
export function NowPlaying() {
  const { current, state, problem, activeSource, soundcloudUrl, videoOpen } = usePlayer();

  const active = current !== null;

  const youtubeUrl =
    current?.sources.find((source) => source.source === "ytmusic")?.url ??
    (current
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
          [current.title, current.artists[0]].filter(Boolean).join(" "),
        )}`
      : null);

  // Sits clear of the player bar on desktop, and of the mini player plus bottom
  // nav on a phone.
  return (
    <div
      className={`pointer-events-none fixed bottom-[calc(var(--bar-h)+var(--nav-h)+0.75rem)] right-3 z-40 w-[19rem] max-w-[calc(100vw-1.5rem)] transition-all duration-300 ease-[var(--ease)] lg:bottom-[calc(var(--bar-h)+0.75rem)] lg:right-4 lg:w-[21rem] ${
        active && videoOpen
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-3 scale-[0.98] opacity-0"
      }`}
      aria-hidden={!active || !videoOpen}
    >
      <div className="pointer-events-auto overflow-hidden rounded-[var(--r-lg)] bg-black shadow-2xl ring-1 ring-white/10">
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
            className="flex items-center justify-center gap-2 bg-[var(--surface-2)] px-3 py-2.5 text-xs font-medium text-[var(--fg)] transition hover:text-[var(--accent)]"
          >
            {problem ?? "Can't play this here"}
            <ExternalIcon className="size-3" />
          </a>
        )}

        {/*
          Exactly one player is mounted at a time. Unmounting the other is what
          makes "only one audible" true by construction rather than by careful
          pausing — a torn-down player cannot be restarted by a stray event
          during handoff. It costs a remount on every source switch, which is
          the right trade for never having two songs at once.
        */}
        <div className="h-[200px]">
          {activeSource === "soundcloud" ? (
            <SoundCloudPlayer trackUrl={soundcloudUrl} />
          ) : (
            <YouTubePlayer />
          )}
        </div>
      </div>
    </div>
  );
}
