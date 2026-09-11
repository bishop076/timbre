"use client";

import { cover as coverSrc } from "./artwork-url";
import { NoteIcon } from "./icons";

const COVER = 30;

const SCATTER = [
  { left: 5, top: 12, rotate: -8 },
  { left: 35, top: 6, rotate: 5 },
  { left: 65, top: 12, rotate: -4 },
  { left: 19, top: 46, rotate: 7 },
  { left: 49, top: 52, rotate: -6 },
] as const;

export function Collage({
  covers,
  className = "",
  rounded = "rounded-[var(--r-lg)]",
}: {
  covers: string[];
  className?: string;
  rounded?: string;
}) {
  const usable = covers.filter(Boolean).slice(0, SCATTER.length);

  if (usable.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-[var(--surface-2)] text-[var(--fg-faint)] ${rounded} ${className}`}
      >
        <NoteIcon className="size-7" />
      </div>
    );
  }

  if (usable.length < 3) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={coverSrc(usable[0], 600) ?? undefined}
        alt=""
        loading="lazy"
        decoding="async"
        className={`object-cover ${rounded} ${className}`}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {usable.map((cover, index) => {
        const spot = SCATTER[index]!;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${cover}-${index}`}
            src={coverSrc(cover, 200) ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute aspect-square rounded-[5px] object-cover shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
            style={{
              width: `${COVER}%`,
              left: `${spot.left}%`,
              top: `${spot.top}%`,
              transform: `rotate(${spot.rotate}deg)`,
              zIndex: index,
            }}
          />
        );
      })}
    </div>
  );
}
