"use client";

import { useHydrated } from "../hydrated";

/**
 * The saturation a sampled banner falls back to when a picture has no usable colour in it.
 * All that is left of the old hue-from-id scheme, which monogram() no longer needs.
 */
export const AVATAR_TONE = { saturation: 0.62 } as const;

const BOOT_INITIAL = {
  "--replay": 'var(--avatar-initial, "")',
  opacity: "var(--avatar-letter, 1)",
} as React.CSSProperties;

/**
 * The letter avatar, in the app’s colour rather than one hashed from the id.
 *
 * This used to derive a hue from `avatarHue(id)`, which put a different random colour on every
 * reader — reasonable when the accent followed the artwork and the app had no fixed colour of
 * its own. It does now: the default accent source is "fixed", so the app stays pink instead of
 * repainting itself per cover, and a violet circle in the corner of a pink app is the one
 * element on screen that nobody chose. Following --accent also means the monogram tracks a
 * custom accent for free, which the hash could never do.
 *
 * Both halves of the gradient are tokens on the boot script’s PALETTE, and color-mix is on its
 * FUNCTIONS list, so the string still survives `css()` when it is replayed into --avatar-fill
 * before first paint.
 */
export function monogram(id: string, name: string | null, fallback: string) {
  const first = (name?.trim() || fallback.trim()).codePointAt(0);

  return {
    initial: first === undefined ? "?" : String.fromCodePoint(first).toUpperCase(),
    fill: "linear-gradient(140deg, var(--accent), color-mix(in oklab, var(--accent) 55%, var(--ink)))",
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
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-2)] bg-cover bg-center font-extrabold text-[var(--accent-fg)] ${className} ${textClassName}`}
      style={{
        // JSON.stringify, not `url("${image}")`. Those quotes were hand-written, so a value
        // carrying one of its own ended the function early and a second url() could be
        // appended after it — which is exactly what a planted thumbnail did before readThumb
        // was tightened. The two locks are deliberately independent: this one holds even if a
        // future caller hands us something readThumb never saw.
        backgroundImage: image
          ? `url(${JSON.stringify(image)})`
          : (drawn?.fill ?? "var(--avatar-thumb, var(--avatar-fill, none))"),
      }}
    >
      <span className="replay" style={known ? undefined : BOOT_INITIAL}>
        {drawn?.initial}
      </span>
    </span>
  );
}
