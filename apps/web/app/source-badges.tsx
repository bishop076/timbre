"use client";

/**
 * Which services have this recording — as plain text, and each one playable.
 *
 * **They used to be links only, and that was a waste of the one thing Timbre knows.** A song
 * carrying four names is four services that have it, and the app can start most of them — so
 * a name that only opened soundcloud.com was sending the reader away from the player to
 * reach a copy the player could have played. The name plays; the arrow beside it opens.
 *
 * **Not every name can play, and it says so rather than pretending.** `playbackFrom` is the
 * single source of truth — it mirrors the ladder in `player-context.tsx`:
 *
 * - `queue`   — the song, auto-advancing. YouTube Music, SoundCloud, Audius, Mixcloud, Archive.
 * - `manual`  — Spotify, Apple, Deezer. Their embeds have no play API, so the queue rests
 *   until pressed; in exchange a signed-in subscriber hears the whole song.
 * - `preview` — a thirty-second clip, and it has to say thirty seconds or it is a lie of
 *   exactly the shape `soundcloud.ts` drops `SNIP` rows to avoid.
 *
 * ---
 *
 * **On the look, after two wrong tries.** First these were saturated pills — brand-coloured
 * text on a brand tint, four of them shouting at once. Then they were slabs, which matched
 * the app's vocabulary but put a bordered, shadowed box around four short words and read as
 * bulky. A row of names is not four controls that each need a frame.
 *
 * So: no chip, no border, no dot. Just the service's name in the dim tone every secondary
 * label in this app uses, taking its brand colour on hover so the identity is still there
 * when you reach for it. The arrow holds its space at low opacity rather than appearing on
 * hover, because four names that shift sideways as the pointer crosses them is worse than a
 * faint glyph.
 */

import type { Song } from "./types";
import { ExternalIcon } from "./icons";
import { playbackFrom, usePlayerControls } from "./player/player-context";
import { openSpotifyWindow, spotifyPreviewsOnly } from "./spotify/preview-mode.ts";
import { sourceStyle } from "./sources";
import { SOURCE_TAG, SOURCE_TAG_ACTIVE, sourceTone } from "./source-tag";

/** What pressing the name will do, in the reader's terms. Also the accessible name: the
 * visible text is a service name, which on its own does not say it is a button.
 *
 * **`manual` says what the press is worth**, because that is the entire reason to choose
 * Apple or Deezer over the clip the ladder would otherwise reach. */
function playLabel(kind: "queue" | "manual" | "preview", label: string): string {
  if (kind === "preview") return `Play 30 seconds from ${label}`;
  if (kind === "manual") return `Play on ${label} — the full song if you're signed in`;
  return `Play from ${label}`;
}

export function SourceBadges({ song, className = "" }: { song: Song; className?: string }) {
  const { play } = usePlayerControls();

  return (
    <div className={`shrink-0 items-center gap-3 ${className}`}>
      {song.sources.map((source) => {
        const style = sourceStyle(source.source);
        const kind = playbackFrom(song, source.source);
        const open = source.url ?? undefined;

        return (
          <span key={source.source} className="inline-flex items-center gap-1">
            {kind ? (
              <button
                type="button"
                onClick={() => {
                  // **Spotify, once this browser is known to get clips only.** The embed
                  // cannot see the login from inside a frame, and the same page opened
                  // top-level can — but only from a gesture, which this is. Everything else,
                  // and Spotify before the first clip, plays in the app as usual.
                  if (source.source === "spotify" && spotifyPreviewsOnly() && source.sourceId) {
                    openSpotifyWindow(source.sourceId);
                    return;
                  }
                  play(song, [], source.source);
                }}
                title={playLabel(kind, style.label)}
                aria-label={playLabel(kind, style.label)}
                className={`${SOURCE_TAG} ${SOURCE_TAG_ACTIVE}`}
                style={sourceTone(source.source)}
              >
                {style.short}
                {/* Only the clip is qualified. `manual` is *not* — Apple and Deezer play the
                    whole song for a subscriber, and stamping "30s" on them would understate
                    them for exactly the reader who gets the most from pressing. */}
                {kind === "preview" && <span className="opacity-70"> 30s</span>}
              </button>
            ) : (
              // No copy here Timbre can start, so nothing offers to.
              <span className={SOURCE_TAG}>{style.short}</span>
            )}

            {open && (
              <a
                href={open}
                target="_blank"
                rel="noreferrer noopener"
                title={`Open on ${style.label}`}
                aria-label={`Open on ${style.label}`}
                className="text-[var(--fg-faint)] opacity-40 transition hover:opacity-100 focus-visible:opacity-100"
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
