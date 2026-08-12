"use client";

import { useEffect, useRef } from "react";

import { buildPalette, type Palette, type Swatch } from "../theme/palette";
import { getThemeSnapshot, isLightTheme, useTheme, type ThemeState } from "../theme/theme-store";

/**
 * Recolours the app from the current track's artwork.
 *
 * The idea is Material You's: the interface takes on the colour of what is
 * playing, so the player feels like part of the album rather than a chrome
 * wrapper around it. Implemented here for the web, from scratch.
 *
 * **Why the colour is chosen the way it is.** The naive approach — average the
 * pixels — always returns mud, because averaging opposing hues cancels them.
 * Instead pixels are bucketed by hue, each bucket scored on saturation and how
 * far its lightness sits from both extremes, and the winning *region* of the
 * wheel decides. Its colour is then forced into a legible range by
 * `buildPalette`, so a dark cover still yields a usable accent, not a black one.
 *
 * Two things in here were picking visibly wrong colours and are worth knowing
 * about: hue is an angle and has to be averaged as one, and a hue sitting on a
 * bucket boundary must not lose to a lesser one that sits in the middle of a
 * bucket. Both are explained at the point they are handled.
 *
 * **Cross-origin is the real constraint.** Artwork comes from whichever CDN the
 * source uses, and reading pixels requires that CDN to allow it. When it does
 * not, the canvas is tainted and `getImageData` throws. That is expected, not
 * exceptional: the app simply keeps the default accent. Failure has to be
 * silent and total, never a half-applied colour.
 */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

/**
 * 24 hue buckets — fine enough to separate teal from green, coarse enough that
 * gradients and compression noise do not split one colour across two.
 */
const BUCKETS = 24;

/**
 * How many neighbouring buckets are counted together when picking the winner.
 *
 * **A hue that straddles a boundary must not lose to a lesser one that happens
 * to sit in the middle of a bucket.** Red is the worst case and the most common:
 * it lives at both ends of the wheel, so a red cover splits across bucket 23 and
 * bucket 0 and can be beaten by a smaller patch of, say, orange sitting tidily
 * inside one bucket. Scoring a sliding window of three buckets — wrapping around
 * the wheel — asks "which *region* of the wheel does this cover live in", which
 * is the question that was meant all along.
 */
const WINDOW = 1;

function dominantHue(data: Uint8ClampedArray): { h: number; s: number; l: number } | null {
  const weight = new Float64Array(BUCKETS);
  // Hue is an angle, so it is accumulated as a vector rather than a number —
  // see the circular mean below.
  const sinSum = new Float64Array(BUCKETS);
  const cosSum = new Float64Array(BUCKETS);
  const satSum = new Float64Array(BUCKETS);
  const litSum = new Float64Array(BUCKETS);

  // Stride over the pixels; sampling every 4th is indistinguishable from
  // reading all of them and keeps this off the main thread's critical path.
  for (let i = 0; i < data.length; i += 16) {
    const alpha = data[i + 3]!;
    if (alpha < 128) continue;

    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);

    // Near-black, near-white and near-grey pixels carry no hue information and
    // are usually background, so they must not win by sheer count.
    if (s < 0.18 || l < 0.12 || l > 0.92) continue;

    // Favour saturated pixels in the middle of the lightness range: those are
    // the colours a person would name if asked what the cover looks like.
    const score = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score <= 0) continue;

    const bucket = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
    const angle = h * Math.PI * 2;
    weight[bucket]! += score;
    sinSum[bucket]! += Math.sin(angle) * score;
    cosSum[bucket]! += Math.cos(angle) * score;
    satSum[bucket]! += s * score;
    litSum[bucket]! += l * score;
  }

  // The best window, wrapping around the wheel.
  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < BUCKETS; i++) {
    let total = 0;
    for (let offset = -WINDOW; offset <= WINDOW; offset++) {
      total += weight[(i + offset + BUCKETS) % BUCKETS]!;
    }
    if (total > bestWeight) {
      bestWeight = total;
      best = i;
    }
  }
  if (best < 0 || bestWeight === 0) return null;

  /*
   * The window chooses the winner; the colour still comes from the bucket
   * itself, plus any neighbour substantial enough to be the same colour.
   *
   * Averaging the whole window unconditionally was a mistake — it dragged a
   * distinct hue toward the middle of a 45° span, so covers that used to get
   * their own colour started coming out shifted and muddy. A neighbour only
   * joins in if it carries a real share of the peak's weight, which is the
   * case this exists for: one colour split across a boundary, not two colours
   * that happen to be adjacent.
   */
  const peak = weight[best]!;
  let sin = 0;
  let cos = 0;
  let sat = 0;
  let lit = 0;
  let total = 0;
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const bucket = (best + offset + BUCKETS) % BUCKETS;
    if (offset !== 0 && weight[bucket]! < peak * 0.5) continue;
    sin += sinSum[bucket]!;
    cos += cosSum[bucket]!;
    sat += satSum[bucket]!;
    lit += litSum[bucket]!;
    total += weight[bucket]!;
  }

  /*
   * The circular mean, and the reason this function was getting colours wrong.
   *
   * Averaging hue as a plain number is only valid away from the wrap. Red sits
   * at both 0.98 and 0.02, and `(0.98 + 0.02) / 2` is **0.5 — cyan**: the exact
   * opposite of the colour on the sleeve. Averaging the angles as unit vectors
   * and reading the direction back with `atan2` has no seam, so red averages to
   * red.
   */
  const angle = Math.atan2(sin / total, cos / total);

  return {
    // `atan2` returns −π…π; the fraction has to come back positive.
    h: (((angle / (Math.PI * 2)) % 1) + 1) % 1,
    s: sat / total,
    l: lit / total,
  };
}

/**
 * Writes a palette onto the document.
 *
 * The ramp itself lives in `theme/palette.ts` and is unit-tested; this only
 * puts it on the element. `data-theme` goes on too, so CSS that cannot be
 * expressed as a custom property — the ambient wash's exposure, which needs a
 * different filter on a light ground — can key off the same decision rather
 * than asking `prefers-color-scheme` and disagreeing with the palette.
 */
/**
 * The last colour the app wore, kept so a reload does not undo it.
 *
 * With nothing playing there is no artwork to sample, and the ramp falls back
 * to its default hue — so every refresh threw away the colour the last song had
 * given the interface and returned it to purple, until something was played
 * again. The theme is *chosen* by the reader and ought to persist like one; it
 * happened to be derived from a cover rather than typed in.
 *
 * Two numbers, so it costs nothing to store and nothing to validate. It is
 * deliberately not the palette itself: the ramp is built by `buildPalette` and
 * a second copy in storage would be a second ramp to keep in step, going stale
 * the first time that file changed.
 */
const SWATCH_KEY = "timbre:swatch";

function rememberSwatch(swatch: Swatch): void {
  try {
    window.localStorage.setItem(SWATCH_KEY, JSON.stringify(swatch));
  } catch {
    // Private browsing or a full quota. The colour simply will not persist.
  }
}

function lastSwatch(): Swatch | null {
  try {
    const raw = window.localStorage.getItem(SWATCH_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    const { hue, sat } = (parsed ?? {}) as Partial<Swatch>;
    // Shape-checked rather than trusted: this is user-editable storage, and a
    // `NaN` hue would produce `hsl(NaN …)` on every surface at once.
    return Number.isFinite(hue) && Number.isFinite(sat)
      ? { hue: hue as number, sat: sat as number }
      : null;
  } catch {
    return null;
  }
}

/**
 * The last palette this app painted, replayed before the next first paint.
 *
 * **Why the swatch alone was not enough.** The blocking script in `layout.tsx`
 * can only set the *ground* — `data-theme` — so the first paint used the static
 * fallback ramp in `globals.css`, and the real ramp arrived once this hook ran.
 * That is the black-then-purple flash: two correct palettes in succession, the
 * generic one and the reader's.
 *
 * So the computed output is cached and replayed. Deliberately the **output**,
 * not the inputs: re-deriving it early would mean a second copy of
 * `buildPalette` written in vanilla JS for the inline script, and that copy
 * would drift from this one the first time the ramp changed. Replaying a
 * recorded result cannot drift — at worst it is one load out of date, and the
 * run below immediately corrects it.
 */
const PALETTE_KEY = "timbre:palette";

function rememberPalette(palette: Palette, theme: ThemeState): void {
  try {
    window.localStorage.setItem(
      PALETTE_KEY,
      JSON.stringify({
        vars: palette,
        theme: isLightTheme(theme) ? "light" : "dark",
        mode: theme.mode,
        neutral: theme.mode === "custom" && theme.customNeutral,
      }),
    );
  } catch {
    // Quota or private browsing. The next load simply starts from the CSS.
  }
}

function apply(swatch: Swatch | null, theme: ThemeState): void {
  const root = document.documentElement;
  const palette = buildPalette(swatch, theme);

  if (swatch) rememberSwatch(swatch);
  rememberPalette(palette, theme);

  for (const [token, value] of Object.entries(palette)) {
    root.style.setProperty(token, value);
  }
  root.dataset.theme = isLightTheme(theme) ? "light" : "dark";
  // The mode as well as the ground: pastel needs a quieter backdrop than a
  // custom light theme does, and "light" alone cannot express that.
  root.dataset.mode = theme.mode;
  // Neutral suppresses the blurred-cover backdrop entirely — see globals.css.
  root.dataset.neutral = String(theme.mode === "custom" && theme.customNeutral);
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  /*
   * Subscribed to for *re-runs*, and reduced to a string for the dependency.
   * The value itself is read live inside the effect — see the note there.
   */
  const subscribed = useTheme();
  const themeKey = `${subscribed.mode}:${subscribed.customHue}:${subscribed.customLight}:${subscribed.customNeutral}`;

  // Avoids re-reading the same image when the component re-renders for an
  // unrelated reason — position ticks twice a second.
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    /*
     * The theme is read live here, not taken from the render.
     *
     * `useTheme()` returns the **server** default during hydration, because the
     * server cannot read storage — and this effect's first run happens on that
     * commit, with that value. `apply()` writes `data-theme` from it, so a
     * reader on a light theme had the correct ground stamped by the blocking
     * script in `layout.tsx` and then immediately overwritten with `dark`. The
     * whole app went black for a moment on every load.
     *
     * It was invisible until today: this hook used to live in `PlayerBar`,
     * which does not mount until something is playing, so on a fresh load
     * nothing ever overwrote the script's work. Moving it into `AppShell` —
     * which was necessary, or choosing a theme did nothing at all — is what
     * exposed it.
     *
     * `getThemeSnapshot()` reads the store directly, and the store reads storage
     * on its first client call, so this is the real theme from the very first
     * run. The `useTheme()` subscription above stays: it is what re-renders this
     * component when the theme changes, which is what re-runs the effect.
     */
    const theme = getThemeSnapshot();

    /*
     * A fixed theme never looks at the artwork.
     *
     * Returning before the image is even fetched is the point of the mode: the
     * reader asked for one colour, so there is nothing to sample and no reason
     * to decode a cover to arrive at a value already known. The backdrop image
     * is still set, since that is the cover itself rather than a colour derived
     * from it.
     */
    if (theme.mode === "custom") {
      lastUrl.current = null;
      document.documentElement.style.setProperty(
        "--artwork-img",
        artworkUrl ? `url("/api/art?u=${encodeURIComponent(artworkUrl)}")` : "none",
      );
      apply(null, theme);
      return;
    }

    if (!artworkUrl) {
      lastUrl.current = null;
      document.documentElement.style.setProperty("--artwork-img", "none");
      // The colour the last cover gave it, rather than back to the default
      // purple — see `lastSwatch`. Nothing is playing yet on a fresh load, so
      // without this every reload discarded the theme.
      apply(lastSwatch(), theme);
      return;
    }
    // The guard is keyed on the theme as well as the URL: switching mode while
    // a song plays has to repaint, and the URL will not have changed.
    if (lastUrl.current === `${theme.mode}:${artworkUrl}`) return;
    lastUrl.current = `${theme.mode}:${artworkUrl}`;

    /*
     * The cover itself, for the wash behind the content panel.
     *
     * Through `/api/art` for the same reason every other image is: a content
     * blocker filtering `i.ytimg.com` would otherwise leave the backdrop empty
     * on exactly the machines that need it most.
     */
    document.documentElement.style.setProperty(
      "--artwork-img",
      `url("/api/art?u=${encodeURIComponent(artworkUrl)}")`,
    );

    let cancelled = false;
    const image = new Image();
    // Harmless now that the source is same-origin, and kept so the element
    // behaves identically if the proxy is ever bypassed.
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      try {
        // 48px is plenty: the dominant colour of a cover survives heavy
        // downscaling, and this keeps the pixel loop trivial.
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, size, size);
        const found = dominantHue(ctx.getImageData(0, 0, size, size).data);
        // `dominantHue` works in 0–1; the palette takes degrees.
        apply(found && { hue: found.h * 360, sat: found.s }, theme);
      } catch {
        // Tainted canvas — this CDN does not allow reading its pixels.
        apply(null, theme);
      }
    };

    image.onerror = () => {
      if (!cancelled) apply(null, theme);
    };

    /*
     * Sampled through `/api/art`, not from the CDN directly.
     *
     * This is the same reason the backdrop goes through it: content blockers
     * filter by hostname, and `i.ytimg.com` is on enough lists that the image
     * simply never loads for anyone running one. `onerror` then fires and the
     * app falls back to its default purple — which is exactly what "the theme
     * does not match the video" looks like, on every song, with no error
     * anywhere.
     *
     * A first-party request matches no blocklist. It also makes the canvas
     * same-origin, so a CDN that stops sending CORS headers can no longer taint
     * the read either.
     */
    image.src = `/api/art?u=${encodeURIComponent(artworkUrl)}`;

    return () => {
      cancelled = true;
    };
    // `themeKey`, not the theme object: the store hands out a fresh object on
    // every write, and this only needs to re-run when the palette would differ
    // — which is exactly when one of those four fields changes.
  }, [artworkUrl, themeKey]);
}
