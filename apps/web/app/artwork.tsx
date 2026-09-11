"use client";

import { useState, type SyntheticEvent } from "react";

import { proxied } from "./artwork-url";
import { NoteIcon } from "./icons";

export function failedAlready(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth === 0 && img.currentSrc !== "";
}

export const hideWhenBroken = {
  onError: (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.visibility = "hidden";
  },
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.style.visibility = "";
  },
  ref: (img: HTMLImageElement | null) => {
    if (img && failedAlready(img)) img.style.visibility = "hidden";
  },
};

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
  const attempted = proxied(chosen);
  const showImage = Boolean(attempted) && failedSrc !== chosen;

  return (
    <span className={`block overflow-hidden ${surfaceClassName} ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempted}
          ref={(img) => {
            if (img && failedAlready(img)) setFailedSrc(chosen ?? null);
          }}
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
