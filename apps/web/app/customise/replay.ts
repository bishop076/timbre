/**
 * What the pre-paint script is allowed to replay, and the only description of it in TypeScript.
 *
 * The redesign lets the reader put a picture of their own behind the app, dim it, blur it and
 * scale the interface. All of that is persisted, and a choice that is only applied after React
 * is up is a choice the reader watches arrive on every single load — so `theme/background.ts`
 * keeps a small copy of the picture in localStorage specifically for the boot script in
 * layout.tsx to replay before the first frame.
 *
 * That boot script is the dangerous one. It runs before React, it reads storage the reader (or
 * anything that can run script once) can edit, and it writes straight onto `<html>`. A value
 * that reaches a CSS `url()` there is a request that fires before paint, on every load, with
 * no UI to notice it — and `img-src` still permits bare `https:`, so CSP does not stop it.
 *
 * This module is the twin of that script's customisation block, and it is deliberately not a
 * second implementation of the rules: the prefs go through `parseTheme` and `backgroundVars`,
 * the very functions the live path uses, so the pre-paint path cannot be validated differently
 * from the hydrated one by accident. The script's ES5 copy is held to this by the parity test
 * in layout.test.ts, which replays one corpus through both and compares what lands on the root.
 *
 * The one rule that is genuinely ours is `isReplayableImage`. Everything else the reader picks
 * is a number or a word from a fixed set; the picture is the only free-form value, and it is
 * the one that is spliced into a `url()`.
 */

import {
  backgroundVars,
  parseTheme,
  type BackgroundPrefs,
  type Theme,
} from "../theme/custom-theme.ts";

/** Mirrors THUMB_KEY in theme/background.ts, which writes the copy this replays. */
export const BACKGROUND_KEY = "timbre:theme-bg";

/** Mirrors THEME_KEY in theme/theme-store.ts. */
export const THEME_KEY = "timbre:theme";

/**
 * Roughly 512KB of base64 — comfortably above the ~40KB thumbnail `theme/background.ts`
 * encodes, and far below the point where parsing a planted string before first paint would be
 * a way to make the app take a visible moment to start.
 */
export const MAX_IMAGE_CHARS = 700_000;

/**
 * A base64 data: URL of a raster type, and nothing else.
 *
 * Every part of that is load-bearing. Not `https:` or `blob:`: a remote background is an
 * outbound request on every load to a host chosen once, and a blob: URL does not outlive the
 * document that minted it, so replaying one can only ever paint nothing. Not `image/svg+xml`:
 * an SVG is a document, and although a background renders it with scripts and external
 * references disabled, it is a parser surface nothing here needs. Not the `data:image/` prefix
 * check the live path settles for, because base64 is an alphabet with no quote in it — which
 * is what stops a stored value from closing the `url(` it is spliced into. The quoting in
 * `replayProperties` is the second lock; this is the first.
 */
export function isReplayableImage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_IMAGE_CHARS &&
    /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export interface Replayed {
  properties: Record<string, string>;
  dataset: Record<string, string>;
}

/**
 * Everything the boot script may put on `<html>` for a stored theme and a stored picture.
 *
 * `ground` is passed in rather than worked out here: the script decides it earlier, from the
 * same legacy fields `theme-store.ts` keeps fresh on every write, and the scrim has to match
 * the ground the page actually ends up on or the first frame is a light wash over dark text.
 */
export function replayProperties(
  stored: { theme?: unknown; background?: unknown },
  ground: "light" | "dark",
): Replayed {
  const theme: Theme = parseTheme(stored.theme);
  const properties: Record<string, string> = {};
  const dataset: Record<string, string> = {};

  if (isReplayableImage(stored.background)) {
    const prefs: BackgroundPrefs = theme.background;
    dataset.bgImage = "true";
    // JSON.stringify, not a bare url(…) — the quoting is what stops a value from ending the
    // function early, and the alphabet above is what stops it from needing to.
    properties["--app-bg-image"] = `url(${JSON.stringify(stored.background)})`;
    Object.assign(properties, backgroundVars(prefs, ground === "light"));
  }

  // The interface scale, replayed for the same reason as the picture: text that is set at the
  // reader's size only after hydration is text that visibly resizes on every load. Mirrors
  // setTextScale() in theme/theme-css.ts, including its "1 removes the property" rule.
  properties["--ui-scale"] = String(theme.textScale);
  if (theme.textScale !== 1) properties["font-size"] = `${Math.round(theme.textScale * 100)}%`;

  return { properties, dataset };
}
