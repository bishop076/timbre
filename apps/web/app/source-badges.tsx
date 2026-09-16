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
  "hidden opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100 @xl:flex";

/**
 * The two badges are the smallest controls in the app: the source name renders at 11px in a box
 * 16.5px tall, and the "open on" glyph is a 10x10 square. WCAG 2.5.8 asks for 24x24, and both
 * miss it by more than half — on a phone this is a pair of targets the width of a fingernail
 * sitting 4px apart.
 *
 * Grown with an absolutely-positioned `::before` rather than padding. Padding would work, but
 * every way of cancelling it again — a negative margin, most obviously — is cancelled *by the
 * flex container*: a `-mr-2.5` on the last badge genuinely narrows the badge track, and the
 * duration column beside it slides 10px left. An out-of-flow box takes no space at all, so the
 * hit area grows and the picture does not move by a pixel.
 *
 * The numbers are what the gaps allow. Vertically there is nothing above or below, so 7px each
 * side takes the glyph from 10 to 24 and 4px each side takes the name from 16.5 to 24.5. The
 * glyph's width has to come sideways: 4px to the left is exactly the `gap-1` between it and its
 * own name, and 10px to the right is inside the `gap-3` before the next source, so neither
 * expansion reaches another control.
 */
const TAP_NAME = "relative before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
const TAP_GLYPH =
  "relative before:absolute before:-inset-y-[7px] before:-left-1 before:-right-2.5 before:content-['']";

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
                className={`${SOURCE_TAG} ${SOURCE_TAG_ACTIVE} ${TAP_NAME}`}
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
                className={`${TAP_GLYPH} text-[var(--fg-faint)] opacity-70 transition hover:opacity-100 focus-visible:opacity-100`}
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
