"use client";

import { useState } from "react";

import { proxied as viaProxy } from "./artwork-url";
import { NoteIcon } from "./icons";

/** The unsigned, permanent thumbnail for a YouTube id — `hqdefault.jpg` has no signature to expire. */
function plainThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//.exec(url);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

/**
 * Cover art with no way to show a broken image: artwork comes from arbitrary CDNs and
 * some of it fails, so a failure falls back to the note placeholder.
 */
export function Artwork({
  src,
  className = "",
  iconClassName = "size-5",
  /*
   * The empty tile's own colours, replaced rather than appended.
   *
   * They cannot come through `className`: both are Tailwind arbitrary values, so
   * they carry equal specificity and the generated stylesheet's order decides
   * which wins, not the class attribute's. A caller that needs a different tone
   * has to substitute it.
   *
   * A song row needs exactly that — its rows are `hover:bg-[var(--surface-2)]`,
   * so a `--surface-2` placeholder disappears into the row under the cursor and
   * leaves a note glyph floating on its own.
   */
  surfaceClassName = "bg-[var(--surface-2)]",
  noteClassName = "text-[var(--fg-faint)]",
  eager,
}: {
  src: string | null | undefined;
  className?: string;
  iconClassName?: string;
  surfaceClassName?: string;
  noteClassName?: string;
  eager?: boolean;
}) {
  // The *url* that failed, not a flag: the bar keeps one instance across every track,
  // so a flag would leave it placeholdered for ever after one bad image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // One retry at a plainer URL: YouTube's signed `?sqp=…&rs=…` thumbnails are tied to
  // the response that carried them, so a replayed one can be refused.
  const chosen = failedSrc === src ? plainThumbnail(src) : src;
  // Through Timbre's origin, so a blocker has no hostname to match.
  const attempted = viaProxy(chosen);
  const showImage = Boolean(attempted) && failedSrc !== chosen;

  return (
    <span className={`block overflow-hidden ${surfaceClassName} ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
        <img
          key={attempted}
          src={attempted ?? undefined}
          alt=""
          loading={eager ? "eager" : "lazy"}
          // Async for shelves, sync for eager: `async` also lets the browser defer the
          // *paint*, so an eager image renders empty first — two paints, not one.
          decoding={eager ? "sync" : "async"}
          onError={() => setFailedSrc(chosen ?? null)}
          className="size-full object-cover"
        />
      ) : (
        <span className={`flex size-full items-center justify-center ${noteClassName}`}>
          <NoteIcon className={iconClassName} />
        </span>
      )}
    </span>
  );
}
