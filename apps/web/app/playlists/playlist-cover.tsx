"use client";

import { Artwork } from "../artwork";

export function PlaylistCover({
  covers,
  className = "",
  iconClassName = "size-8",
  eager,
}: {
  covers: string[];
  className?: string;
  iconClassName?: string;
  eager?: boolean;
}) {
  const usable = covers.filter(Boolean);

  if (usable.length === 0) {
    return <Artwork src={null} className={className} iconClassName={iconClassName} eager={eager} />;
  }

  if (usable.length === 1) {
    return (
      <Artwork src={usable[0]} className={className} iconClassName={iconClassName} eager={eager} />
    );
  }

  const cells = Array.from({ length: 4 }, (_, index) => usable[index % usable.length]!);

  return (
    <span className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
      {cells.map((src, index) => (
        <Artwork
          key={index}
          src={src}
          className="size-full"
          iconClassName="size-3"
          eager={eager}
        />
      ))}
    </span>
  );
}
