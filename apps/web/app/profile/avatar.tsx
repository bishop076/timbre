"use client";

import { useHydrated } from "../hydrated";

/**
 * A picture for a profile that has none.
 *
 * Timbre hosts no uploads and asks for no email, so the alternative to a grey
 * silhouette is one **derived from the profile itself**: an initial over a
 * colour computed from the local id. It is stable for as long as the browser
 * keeps its data, needs no storage and no request, and — unlike Gravatar —
 * tells no third party anything.
 *
 * A real `image` still wins when there is one.
 */

/**
 * FNV-1a, 32-bit. A hash rather than a character code because ids are UUIDs:
 * the first character of a UUID only ever spans `0`–`f`, so using it directly
 * would crowd every profile into sixteen hues.
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
 * The profile's colour, as an HSL hue.
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

/** The letter to show: their name's first, else the fallback's, else nothing. */
function initialOf(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback.trim();
  // `codePointAt` rather than `[0]` so an emoji or a non-BMP character is not
  // sliced in half into a replacement glyph.
  const first = source.codePointAt(0);
  return first === undefined ? "?" : String.fromCodePoint(first).toUpperCase();
}

/**
 * How the monogram looks, as two plain strings.
 *
 * Split out of the component because **the first paint has to draw this before
 * React exists**. The boot script in `layout.tsx` replays a recorded copy of
 * these two values onto `<html>`, and recording the *output* rather than
 * re-deriving it is the only version that cannot drift: a vanilla-JS copy of
 * the hash and the gradient in an inline script would be a second definition
 * of the profile's colour, wrong the first time either changed here.
 *
 * See `recordMonogram` in `local-profile.ts` for the writing side.
 */
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
  /*
   * Who decides what this looks like, and when.
   *
   * Before hydration the answer is CSS: the boot script has already put the
   * cached thumbnail, the gradient and the initial on `<html>`, read straight
   * from storage before the first pixel. Neither the server nor React can know
   * any of it that early, so anything React renders here would be a guess —
   * and a guess replaced a frame later is precisely the flicker this exists to
   * remove.
   *
   * From the first render that can read storage, **React decides and the
   * variables are ignored entirely**. That boundary is not a detail: while the
   * component kept falling back to `--avatar-thumb`, removing a profile
   * picture left the removed picture on screen until the page was reloaded,
   * because nothing clears a custom property that the document is still
   * wearing.
   */
  const hydrated = useHydrated();

  // No id means the local profile has not been read out of storage yet.
  const known = hydrated && Boolean(id);
  const drawn = known && !image ? monogram(id, name, email) : null;

  /*
   * **One element, whatever is showing.** This used to return an `<img>` (via
   * `Artwork`) when there was a picture and a `<span>` when there was not, and
   * the swap between them was a visible flicker in its own right — the picture
   * arrives in two stages by design, a `localStorage` thumbnail first and the
   * full copy from IndexedDB a moment later, and `Artwork` keys its `<img>` on
   * the source. So the second stage *replaced the element*, and a brand-new
   * `<img>` paints its container's grey before it has decoded. The avatar
   * blinked grey on every load, right after everything else had settled.
   *
   * As a background image there is no element to replace and no decode gap: the
   * same box simply changes which URL it draws, and both URLs are local. Nothing
   * is lost by dropping `Artwork` here — its retry and its note-icon fallback
   * exist for remote CDN artwork, and this is never remote. The monogram is
   * already the fallback for "no picture".
   */
  const background = image
    ? // Blob and data URLs contain no quote or backslash, so nothing here needs
      // escaping — they are produced by `URL.createObjectURL` and `toDataURL`.
      `url("${image}")`
    : drawn
      ? drawn.fill
      : // Unset on a first-ever visit, which correctly leaves the plain surface
        // underneath: nothing is known, so nothing is claimed.
        "var(--avatar-thumb, var(--avatar-fill, none))";

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-2)] bg-cover bg-center font-extrabold text-white ${className} ${textClassName}`}
      style={{ backgroundImage: background }}
    >
      {/*
        Empty before hydration on purpose — the `.replay` rule in `globals.css`
        fills it from `--avatar-initial`, and `--avatar-letter` hides it when a
        cached photograph is showing through instead. Empty *permanently* when
        there is a picture: the letter would sit on top of it.
      */}
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
