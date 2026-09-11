"use client";

import { useHydrated } from "../hydrated";

export function avatarHue(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0) % 360;
}

export const AVATAR_TONE = { saturation: 0.62, lightness: 0.52 } as const;

const BOOT_INITIAL = {
  "--replay": 'var(--avatar-initial, "")',
  opacity: "var(--avatar-letter, 1)",
} as React.CSSProperties;

export function monogram(id: string, name: string | null, fallback: string) {
  const hue = avatarHue(id);
  const { saturation, lightness } = AVATAR_TONE;
  const first = (name?.trim() || fallback.trim()).codePointAt(0);
  const from = `hsl(${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;

  return {
    initial: first === undefined ? "?" : String.fromCodePoint(first).toUpperCase(),
    fill: `linear-gradient(140deg, ${from}, hsl(${(hue + 38) % 360} 58% 38%))`,
  };
}

export function Avatar({
  name,
  email,
  image,
  id,
  className,
  textClassName,
}: {
  name: string | null;
  email: string;
  image: string | null;
  id: string;
  className: string;
  textClassName: string;
}) {
  const known = useHydrated() && Boolean(id);
  const drawn = known && !image ? monogram(id, name, email) : null;

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-2)] bg-cover bg-center font-extrabold text-white ${className} ${textClassName}`}
      style={{
        backgroundImage: image
          ? `url("${image}")`
          : (drawn?.fill ?? "var(--avatar-thumb, var(--avatar-fill, none))"),
      }}
    >
      <span className="replay" style={known ? undefined : BOOT_INITIAL}>
        {drawn?.initial}
      </span>
    </span>
  );
}
