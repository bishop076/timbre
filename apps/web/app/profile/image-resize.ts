import type { ImageKind } from "./local-images";

/**
 * Turning a chosen file into something worth storing.
 *
 * Split out of `local-images.ts` for weight, not for tidiness. That module is
 * imported by `shell/sidebar.tsx` for the profile button's avatar, which puts it
 * in the chunk **every route loads** — and this half of it is the canvas
 * decode/crop/re-encode path, which only ever runs when somebody picks a
 * picture. It was being downloaded by every visitor to `/about` to sit unused.
 *
 * Nothing here touches the store's module state, which is what makes the split
 * safe: `redraw` takes a `File` and returns a `Blob`. `setLocalImage` reaches it
 * through a dynamic `import()`, so the code arrives with the file chooser rather
 * than with the page.
 *
 * `ImageKind` is a type-only import, so it creates no runtime dependency back
 * and therefore no cycle.
 */

/**
 * Target sizes. Small enough to stay cheap, large enough not to look soft on a
 * retina screen at the size each is actually drawn.
 */
const SIZES: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1600, height: 500 },
};

/**
 * What each picture will take, named rather than refused.
 *
 * This was a blocklist of one — SVG, because it can carry script — and
 * everything else was waved through on `type.startsWith("image/")`. A list of
 * what is *allowed* is the safer shape: the failure mode of a blocklist is a
 * format nobody considered getting in, and browsers keep adding them.
 *
 * **The two differ on GIF, deliberately.** A banner is a wide still behind a
 * name, and an animation looping under someone's own profile at that size is a
 * distraction they cannot turn off. An avatar is 512px in a circle, which is
 * where an animated picture is a bit of personality rather than a nuisance.
 *
 * AVIF is gone from both. It was in the old `accept` list, but browser support
 * for *decoding* it into a canvas is not the same as support for displaying
 * it, and offering a format that fails at the redraw step is worse than not
 * offering it.
 */
export const ACCEPTED: Record<ImageKind, string[]> = {
  avatar: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  banner: ["image/png", "image/jpeg", "image/webp"],
};

/** Guard before decoding — a malformed huge file should fail fast and cheap. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * The cap for a picture kept exactly as it arrived.
 *
 * An animated GIF cannot go through the canvas — see `redraw` — so it is stored
 * at its original weight, and the usual 25MB guard is far too generous for
 * something that has to be held in this browser's storage and decoded on every
 * paint of the page. Five is roomy for an avatar and small enough that a
 * screen-recording somebody dragged in fails immediately, with a reason.
 */
const MAX_ANIMATED_BYTES = 5 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(message = "That picture is too large for this browser to keep.") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

/**
 * Redraws a chosen file at the target size, cropped to fill.
 *
 * Cover rather than contain: a banner letterboxed inside its own box would show
 * bars in the page's colour, which reads as a broken image. The excess is
 * cropped centrally, which is what every profile editor does.
 *
 * Encoded straight to a Blob rather than a data URL — the base64 step existed
 * only because localStorage cannot hold binary, and it inflated every picture
 * by a third for nothing.
 */
export async function redraw(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError();

  if (!ACCEPTED[kind].includes(file.type)) {
    /*
     * Named formats, and a different sentence for the case somebody will
     * actually hit: a GIF on the banner is a reasonable thing to try, and "not
     * an image Timbre can use" would be a confusing answer about a file the
     * avatar accepts happily.
     */
    throw new Error(
      file.type === "image/gif"
        ? "Banners have to be a still picture — try a PNG, JPEG or WebP. GIFs work on your profile picture."
        : "That has to be a PNG, JPEG or WebP.",
    );
  }

  /*
   * An animated avatar is stored exactly as it arrived.
   *
   * Everything else here goes through a canvas, and a canvas has one frame —
   * drawing a GIF to it produces a still of whichever frame happened to be
   * decoded, so "GIFs allowed" would have meant "GIFs silently flattened",
   * which is worse than refusing them. Skipping the redraw keeps the animation
   * at the cost of the resize, so the size limit does that job instead.
   *
   * The type is re-checked rather than trusted from `ACCEPTED`: only the avatar
   * reaches here with a GIF, and being explicit stops a later edit to the
   * banner's list from quietly turning this on for it too.
   */
  if (kind === "avatar" && file.type === "image/gif") {
    if (file.size > MAX_ANIMATED_BYTES) {
      throw new ImageTooLargeError(
        "That GIF is too large — animated pictures are kept at full size, so they have to be under 5MB.",
      );
    }
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width: maxWidth, height: maxHeight } = SIZES[kind];

  /*
   * The target is a **maximum**, and it never scales up.
   *
   * This used to force every picture to exactly 512×512, whatever it started as
   * — so a 200px avatar off a phone or a social-media crop was stretched to two
   * and a half times its size and then re-encoded at quality 0.82. That bakes
   * the upscale in permanently: the interpolated pixels are what get compressed,
   * so the stored picture is both larger in bytes and visibly softer than the
   * file it came from, and no amount of drawing it smaller later recovers the
   * detail. A small picture is now kept small and sharp, and the browser scales
   * it to the element like it would any other image.
   *
   * The crop is expressed as a source rectangle rather than as an oversized
   * destination, which is the same "cover" result stated directly: take the
   * largest centred region of the source that has the target's aspect ratio,
   * and write it out at up to the target size.
   */
  const cropWidth = Math.min(bitmap.width, (bitmap.height * maxWidth) / maxHeight);
  const cropHeight = Math.min(bitmap.height, (bitmap.width * maxHeight) / maxWidth);
  const shrink = Math.min(1, maxWidth / cropWidth);
  const width = Math.max(1, Math.round(cropWidth * shrink));
  const height = Math.max(1, Math.round(cropHeight * shrink));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't process images.");

    // Better resampling for the downscale, where a browser offers a choice.
    context.imageSmoothingQuality = "high";

    context.drawImage(
      bitmap,
      (bitmap.width - cropWidth) / 2,
      (bitmap.height - cropHeight) / 2,
      cropWidth,
      cropHeight,
      0,
      0,
      width,
      height,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      // WebP where the browser will encode it. Browsers that cannot silently
      // hand back a PNG instead of failing, so the type is checked afterwards
      // rather than assumed.
      canvas.toBlob((result) => resolve(result), "image/webp", 0.82);
    });

    if (blob && blob.type === "image/webp") return blob;

    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.85);
    });

    if (!jpeg) throw new Error("This browser couldn't encode that picture.");
    return jpeg;
  } finally {
    // Frees the decoded frame immediately rather than at the next collection.
    bitmap.close();
  }
}
