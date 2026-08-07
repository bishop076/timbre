"use client";

import { useState } from "react";

import { proxied as viaProxy } from "./artwork-url";
import { NoteIcon } from "./icons";

/**
 * The unsigned, permanent thumbnail for a YouTube video id, or null when the
 * url is not one of YouTube's. `hqdefault.jpg` exists for every video and
 * carries no signature to expire, which is the one failure a retry can fix.
 */
function plainThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//.exec(url);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

/**
 * Cover art, with no way to show a broken image.
 *
 * Artwork comes from arbitrary source CDNs and some of it fails: YouTube's
 * signed `?sqp=…&rs=…` thumbnail URLs are not guaranteed to outlive the
 * response that carried them, "Recently played" replays URLs stored days ago,
 * and any of it can 404 or be blocked by an extension. A bare `<img>` answers
 * all of that with the browser's broken-image glyph, which is far uglier than
 * having no picture at all.
 *
 * So a failure falls back to the same note placeholder used when a track has no
 * artwork in the first place — one appearance for "no picture", whatever the
 * reason, and the caller does not have to care which.
 */
export function Artwork({
  src,
  className = "",
  iconClassName = "size-5",
  eager,
}: {
  src: string | null | undefined;
  /** Applied to the wrapper, so the caller controls size and shape. */
  className?: string;
  iconClassName?: string;
  /** Skips lazy loading, for artwork that is visible immediately. */
  eager?: boolean;
}) {
  // The *url* that failed, not a boolean. The player bar keeps one instance
  // across every track, so a flag would leave it permanently placeholdered
  // after a single bad image; comparing urls resets it on the next song.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  /*
   * One retry, at a plainer URL.
   *
   * YouTube's watch queue hands back signed thumbnails —
   * `/vi/<id>/hq720.jpg?sqp=…&rs=…` — whose signature is tied to the response
   * that carried it. Replayed later (a stored "recently played" entry, a shelf
   * rendered minutes after its fetch) it can be refused, while the unsigned
   * `hqdefault.jpg` for the same video is permanent and always present.
   *
   * So a failure falls back to that before giving up. If the domain itself is
   * unreachable — a blocker, or an offline machine — the retry fails too and
   * the placeholder appears, which is the correct end state either way.
   */
  const chosen = failedSrc === src ? plainThumbnail(src) : src;
  // Everything goes through Timbre's origin, so a blocker has no hostname to
  // match. The retry above still applies underneath it.
  const attempted = viaProxy(chosen);
  const showImage = Boolean(attempted) && failedSrc !== chosen;

  return (
    <span className={`block overflow-hidden bg-[var(--surface-2)] ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
        <img
          key={attempted}
          src={attempted ?? undefined}
          alt=""
          loading={eager ? "eager" : "lazy"}
          /*
           * Async for the shelves, **sync for anything asked for eagerly**.
           *
           * Explore puts fifty-odd covers on one page, most of them 250px
           * squares shown in boxes a fraction of that. Decoding those on the
           * main thread as they paint lands as one long block of work on the
           * thread that also answers scrolling, so `async` is a real win there.
           *
           * It is exactly wrong for an `eager` image. `async` does not only
           * move the decode — it lets the browser *defer the paint* until the
           * decode finishes, so the element renders empty first and fills in
           * afterwards. On the profile avatar that turned one paint into two:
           * the grey placeholder behind this element, and then the picture.
           * `eager` already means "this one is wanted now", so it is the exact
           * set of images that must not be deferred.
           */
          decoding={eager ? "sync" : "async"}
          onError={() => setFailedSrc(chosen ?? null)}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-[var(--fg-faint)]">
          <NoteIcon className={iconClassName} />
        </span>
      )}
    </span>
  );
}
