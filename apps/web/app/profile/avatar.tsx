"use client";

import { useHydrated } from "../hydrated";

/** A picture for a profile that has none: an initial over a colour computed from the local
 * id. No storage, no request, nothing told to a third party. A real `image` still wins. */

/** FNV-1a, 32-bit. A hash rather than a character code because a UUID's first character
 * only spans `0`–`f`, which would crowd every profile into sixteen hues. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

/** The profile's colour as an HSL hue. The one definition — the header is washed in it. */
export function avatarHue(id: string): number {
  return hash(id) % 360;
}

/** Saturation and lightness of the monogram's first gradient stop, so callers can match
 * the surface without restating the numbers. */
export const AVATAR_TONE = { saturation: 0.62, lightness: 0.52 } as const;

/** The letter to show: their name's first, else the fallback's, else nothing. */
function initialOf(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback.trim();
  // `codePointAt` rather than `[0]`, so an emoji is not sliced into a replacement glyph.
  const first = source.codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
}

/** How the monogram looks, as two plain strings. Split out because the first paint draws
 * this before React exists: `layout.tsx`'s boot script replays a recorded copy of the
 * *output*, since re-deriving it inline would be a second definition of the colour. */
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
  /** Seeds the colour, so it never changes when the display name does. */
  id: string;
  className?: string;
  textClassName?: string;
}) {
  /* Before hydration CSS decides, from the boot script's values on `<html>`; from the first
   * render that can read storage React decides and the variables are ignored entirely. While
   * this kept falling back to `--avatar-thumb`, removing a profile picture left it on screen
   * until a reload, because nothing clears a custom property the document is wearing. */
  const hydrated = useHydrated();

  // No id means the local profile has not been read out of storage yet.
  const known = hydrated && Boolean(id);
  const drawn = known && !image ? monogram(id, name, email) : null;

  /* One element, whatever is showing. The picture arrives in two stages — a `localStorage`
   * thumbnail then the full copy from IndexedDB — and `Artwork` keys its `<img>` on the
   * source, so stage two replaced the element and a new `<img>` paints its container's grey
   * before decoding. A background image has no element to replace and no decode gap. */
  const background = image
    ? // Blob and data URLs contain no quote or backslash, so nothing needs escaping.
      `url("${image}")`
    : drawn
      ? drawn.fill
      : // Unset on a first-ever visit, leaving the plain surface underneath.
        "var(--avatar-thumb, var(--avatar-fill, none))";

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-2)] bg-cover bg-center font-extrabold text-white ${className} ${textClassName}`}
      style={{ backgroundImage: background }}
    >
      {/* Empty before hydration on purpose — `.replay` in `globals.css` fills it from
          `--avatar-initial`, and `--avatar-letter` hides it when a cached photograph is
          showing through. Empty permanently when there is a picture. */}
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
