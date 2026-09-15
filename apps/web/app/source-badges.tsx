"use client";

import type { Song } from "./types";
import { ExternalIcon } from "./icons";
import { playbackFrom, usePlayerControls } from "./player/player-context";
import { sourceStyle } from "./sources";
import { SOURCE_TAG, SOURCE_TAG_ACTIVE, sourceTone } from "./source-tag";

function playLabel(kind: "queue" | "manual" | "preview", label: string): string {
  if (kind === "preview") return `Play 30 seconds from ${label}`;
  if (kind === "manual") return `Play on ${label} — the full song if you're signed in`;
  return `Play from ${label}`;
}

export const ROW_BADGES =
  "hidden opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 @xl:flex";

export function SourceBadges({ song, className = "" }: { song: Song; className?: string }) {
  const { play } = usePlayerControls();

  return (
    <div className={`shrink-0 items-center gap-3 ${className}`}>
      {song.sources.map((source) => {
        const style = sourceStyle(source.source);
        const kind = playbackFrom(song, source.source);

        return (
          <span key={source.source} className="inline-flex items-center gap-1">
            {kind ? (
              <button
                type="button"
                onClick={() => play(song, [], source.source)}
                title={playLabel(kind, style.label)}
                aria-label={playLabel(kind, style.label)}
                className={`${SOURCE_TAG} ${SOURCE_TAG_ACTIVE}`}
                style={sourceTone(source.source)}
              >
                {style.short}
                {kind === "preview" && <span className="opacity-70"> 30s</span>}
              </button>
            ) : (
              <span className={SOURCE_TAG}>{style.short}</span>
            )}

            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                title={`Open on ${style.label}`}
                aria-label={`Open on ${style.label}`}
                // 0.4 measured 1.77:1 against the light page — below the 3.0 a non-text control needs.
                // It is meant to be quiet until you look for it, not invisible until you hover.
                className="text-[var(--fg-faint)] opacity-70 transition hover:opacity-100 focus-visible:opacity-100"
              >
                <ExternalIcon className="size-2.5" />
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}
