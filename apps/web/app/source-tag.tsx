"use client";

/**
 * **The one description of how a source's name looks, anywhere in the app.**
 *
 * There were five: two in `now-playing.tsx`, one in `playlist-view.tsx`, one in the search
 * results and one in the player bar — each a hand-rolled
 * `rounded-full px-1.5 py-px … {color, backgroundColor}`. Changing the look meant finding
 * all five, and the first two attempts at restyling missed some, so the same song showed a
 * plain name in one place and a filled pill in another.
 *
 * Everything that names a source now goes through here. `SourceBadges` (a row of playable
 * names) and `SourceLink` (the copyable one in the transport) are both built on it, so a
 * change to the tone, size or weight lands everywhere at once.
 *
 * **Naming the source that is actually playing is a terms requirement** for every service
 * Timbre embeds — that is why this exists at all, and why the plain-text treatment keeps the
 * service's own name and colour rather than reducing it to an icon.
 */

import { sourceStyle } from "./sources";

/** The resting look: a secondary label, the same tone as every other one in the app. */
export const SOURCE_TAG = "text-[11px] text-[var(--fg-faint)] transition-colors";

/** Added when the name is pressable — the brand colour arrives on hover rather than sitting
 * at rest, so four of them in a row do not compete with the song title. */
export const SOURCE_TAG_ACTIVE = "hover:text-[var(--tone)]";

/** The service's brand colour, as the `--tone` custom property {@link SOURCE_TAG_ACTIVE}
 * reads. A variable rather than an inline `color` so the hover state can be pure CSS. */
export function sourceTone(source: string): Record<string, string> {
  return { "--tone": sourceStyle(source).color };
}

/** A source's name, not interactive. For attribution beside a title. */
export function SourceTag({ source, className = "" }: { source: string; className?: string }) {
  return <span className={`${SOURCE_TAG} shrink-0 ${className}`}>{sourceStyle(source).short}</span>;
}
