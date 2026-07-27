"use client";

import { useState } from "react";

import { ChevronIcon, ExternalIcon } from "../icons";
import { usePlayer } from "./player-context";
import { YouTubePlayer } from "./youtube-player";

/**
 * The video panel.
 *
 * This exists because the player **cannot** be a thumbnail: YouTube's IFrame
 * API requires at least 200×200 pixels, and below that playback fails with a
 * bare "Video unavailable" in every browser. It is also what YouTube's policy
 * on keeping the player visible and unobscured wants.
 *
 * So it floats above the player bar at a genuine size. It can be collapsed —
 * the player keeps its dimensions when collapsed and is merely moved out of
 * sight, because resizing it below the minimum would break playback.
 */
export function NowPlaying() {
  const { current, state, problem } = usePlayer();
  const [collapsed, setCollapsed] = useState(false);

  const active = current !== null;

  const youtubeUrl =
    current?.sources.find((source) => source.source === "ytmusic")?.url ??
    (current ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
      [current.title, current.artists[0]].filter(Boolean).join(" "),
    )}` : null);

  return (
    <div
      className={`pointer-events-none fixed bottom-24 right-4 z-40 w-[356px] max-w-[calc(100vw-2rem)] transition-all duration-300 ${
        active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <p className="truncate text-xs font-medium text-[var(--muted)]">
            {state === "resolving"
              ? "Finding a playable copy…"
              : state === "unplayable"
                ? (problem ?? "Can't play this")
                : (current?.title ?? "")}
          </p>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Show video" : "Hide video"}
            aria-expanded={!collapsed}
            className="shrink-0 rounded p-1 text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            <ChevronIcon className={`size-4 transition ${collapsed ? "" : "rotate-180"}`} />
          </button>
        </div>

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
            className="flex items-center justify-center gap-2 border-t border-[var(--border)] bg-[var(--surface-hover)] px-3 py-2.5 text-xs font-medium text-[var(--foreground)] transition hover:text-[var(--accent)]"
          >
            Watch on YouTube instead
            <ExternalIcon className="size-3" />
          </a>
        )}

        {/*
          Collapsing hides the panel by clipping it, and never by shrinking the
          player: dropping under 200px would stop playback dead.
        */}
        <div
          className={`overflow-hidden transition-all duration-300 ${
            collapsed ? "h-0" : "h-[200px]"
          }`}
        >
          <YouTubePlayer />
        </div>
      </div>
    </div>
  );
}
