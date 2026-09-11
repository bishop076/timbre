"use client";

import { useHydrated } from "../hydrated";

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

export function avatarHue(id: string): number {
  return hash(id) % 360;
}

export const AVATAR_TONE = { saturation: 0.62, lightness: 0.52 } as const;

function initialOf(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback.trim();
  const first = source.codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
}

export function monogram(id: string, name: string | null, fallback: string) {
  const hue = avatarHue(id);
  const { saturation, lightness } = AVATAR_TONE;

  return {
    initial: initialOf(name, fallback),
    fill:
      `linear-gradient(140deg,` +
      ` hsl(${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%),` +
      ` hsl(${(hue + 38) % 360} 58% 38%))`,
  };
}

export function Avatar({
  name,
  email,
  image,
  id,
  className = "size-24",
  textClassName = "text-3xl",
}: {
  name: string | null;
  email: string;
  image: string | null;
  id: string;
  className?: string;
  textClassName?: string;
}) {
  const hydrated = useHydrated();

  const known = hydrated && Boolean(id);
  const drawn = known && !image ? monogram(id, name, email) : null;

  const background = image
    ? `url("${image}")`
    : drawn
      ? drawn.fill
      : "var(--avatar-thumb, var(--avatar-fill, none))";

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-2)] bg-cover bg-center font-extrabold text-white ${className} ${textClassName}`}
      style={{ backgroundImage: background }}
    >
      <span
        className="replay"
        style={
          known
            ? undefined
            : ({
                "--replay": 'var(--avatar-initial, "")',
                opacity: "var(--avatar-letter, 1)",
              } as React.CSSProperties)
        }
      >
        {drawn?.initial}
      </span>
    </span>
  );
}
