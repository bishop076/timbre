"use client";

/**
 * The source badge in the transport, made copyable.
 *
 * It already had to be there — naming the service actually playing is a terms requirement
 * for every embed Timbre uses — so it was a label doing one job while sitting exactly where
 * someone wants the link. Pressing it copies **that service's** URL for the song playing,
 * not a Timbre one: there is no Timbre URL for a song (the queue is not in the address bar),
 * and the useful thing to send someone is the page on the service they can open.
 *
 * Which URL depends on which source won, so the same song copies a different link depending
 * on what is playing it — which is the point. A song with no URL for its active source falls
 * back to a plain label rather than a button that would copy nothing.
 */

import { useEffect, useRef, useState } from "react";

import type { Song } from "../types";
import { sourceStyle } from "../sources";
import { SOURCE_TAG, SOURCE_TAG_ACTIVE, sourceTone } from "../source-tag";

/** How long the badge shows "Copied" before returning to the service's name. */
const COPIED_MS = 1600;

export function SourceLink({
  song,
  activeSource,
  label,
  className = "",
}: {
  song: Song | null;
  activeSource: string | null;
  /** What the badge would otherwise read — "finding a copy…" while resolving. */
  label: string;
  className?: string;
}) {
  /** The URL last copied, rather than a boolean.
   *
   * A track change while "Copied" is showing must not leave the *new* source's badge
   * claiming something was copied from it. Resetting that in an effect is the obvious move
   * and is the one thing `react-hooks/set-state-in-effect` forbids — so the confirmation is
   * derived instead: it shows only while the copied URL is still the one on screen, and a
   * different song or a different source stops matching on its own. */
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const style = sourceStyle(activeSource ?? "ytmusic");
  const url = song?.sources.find((entry) => entry.source === activeSource)?.url ?? null;
  const copied = url !== null && copiedUrl === url;

  // **Plain text, not a pill.** This sits directly beside the artist name, which is itself
  // plain dim text — a filled, brand-coloured chip there was the loudest thing in the bar and
  // the only chip anywhere near it. Naming the source that is actually playing is a terms
  // requirement for every embed Timbre uses; nothing requires it to shout. The brand colour
  // arrives on hover, the same move `source-badges.tsx` makes.
  const badge = `${SOURCE_TAG} shrink-0 ${className}`;
  const paint = sourceTone(activeSource ?? "ytmusic");

  if (!url) return <span className={badge}>{label}</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopiedUrl(url);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedUrl(null), COPIED_MS);
    } catch {
      // Denied permission, or an insecure origin. Nothing useful to say and nothing to
      // retry — the link is still one click away through the badges on the row.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      // The service is named in the accessible name too: a screen reader otherwise hears
      // only "copy link", which is the one thing the sighted badge makes obvious.
      aria-label={`Copy the ${style.label} link for ${song?.title ?? "this song"}`}
      title={`Copy the ${style.label} link`}
      className={`${badge} ${SOURCE_TAG_ACTIVE} cursor-pointer`}
      style={paint}
    >
      {/* `aria-live` so the confirmation is announced rather than only seen. */}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
