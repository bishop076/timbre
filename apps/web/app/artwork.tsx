"use client";

import { useState } from "react";

import { proxied as viaProxy } from "./artwork-url";
import { NoteIcon } from "./icons";

function plainThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//.exec(url);
  return match ? `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg` : null;
}

export function Artwork({
  src,
  className = "",
  iconClassName = "size-5",
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const chosen = failedSrc === src ? plainThumbnail(src) : src;
  const attempted = viaProxy(chosen);
  const showImage = Boolean(attempted) && failedSrc !== chosen;

  return (
    <span className={`block overflow-hidden ${surfaceClassName} ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempted}
          src={attempted ?? undefined}
          alt=""
          loading={eager ? "eager" : "lazy"}
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
