"use client";

import { Artwork } from "../artwork";

/**
 * A picture for an account that has none.
 *
 * Magic-link sign-in supplies no avatar, and Timbre hosts no uploads, so the
 * alternative to a grey silhouette is one **derived from the account itself**:
 * an initial over a colour computed from the user id. It is stable for the
 * life of the account, identical on every device, needs no storage and no
 * request, and — unlike Gravatar — tells no third party who is signed in.
 *
 * A real `image` still wins when there is one, so this costs nothing if OAuth
 * providers are ever added.
 */

/**
 * FNV-1a, 32-bit. A hash rather than a character code because ids are UUIDs:
 * the first character of a UUID only ever spans `0`–`f`, so using it directly
 * would crowd every account into sixteen hues.
 */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

/**
 * The account's colour, as an HSL hue.
 *
 * Exported because the profile header is washed in it, and the two must agree:
 * a header that does not match the picture it sits behind looks like a
 * mismatch rather than a scheme. This is the **one** definition — computing it
 * twice is how they would drift apart the first time either changed.
 */
export function avatarHue(id: string): number {
  return hash(id) % 360;
}

/**
 * Saturation and lightness of the monogram's first gradient stop, so callers
 * can build a matching surface without restating the numbers.
 */
export const AVATAR_TONE = { saturation: 0.62, lightness: 0.52 } as const;

/** The letter to show: their name's first, else the email's, else nothing. */
function initialOf(name: string | null, email: string): string {
  const source = name?.trim() || email.trim();
  // `codePointAt` rather than `[0]` so an emoji or a non-BMP character is not
  // sliced in half into a replacement glyph.
  const first = source.codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
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
  if (image) {
    return <Artwork src={image} className={`${className} rounded-full`} eager />;
  }

  const hue = avatarHue(id);
  const { saturation, lightness } = AVATAR_TONE;

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold text-white ${className} ${textClassName}`}
      style={{
        // Two stops of the same hue rather than a flat fill: a plain circle of
        // colour reads as a missing image, while a gradient reads as chosen.
        backgroundImage:
          `linear-gradient(140deg,` +
          ` hsl(${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%),` +
          ` hsl(${(hue + 38) % 360} 58% 38%))`,
      }}
    >
      {initialOf(name, email)}
    </span>
  );
}
