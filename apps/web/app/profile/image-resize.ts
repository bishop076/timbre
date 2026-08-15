import type { ImageKind } from "./local-images";

// Turning a chosen file into something worth storing. Split out of `local-images.ts` for
// weight — that module is in every route's bundle. `ImageKind` is type-only, so there is
// no runtime dependency back and no cycle.

/** Target sizes. Cheap, but not soft on a retina screen at the drawn size. */
const SIZES: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1600, height: 500 },
};

// An allowlist, not a blocklist, whose failure mode is a format nobody considered (SVG
// can carry script). GIF is avatar-only: a banner animating under someone's own name
// cannot be turned off. AVIF is on neither, because support for *decoding* it into a
// canvas is not the same as support for displaying it.
export const ACCEPTED: Record<ImageKind, string[]> = {
  avatar: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  banner: ["image/png", "image/jpeg", "image/webp"],
};

/** Guard before decoding — a malformed huge file should fail fast and cheap. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

// The cap for a picture kept exactly as it arrived. An animated GIF cannot go through the
// canvas, so it is stored at full weight and decoded on every paint — 5MB is roomy for an
// avatar and small enough that a dragged-in screen recording is refused.
const MAX_ANIMATED_BYTES = 5 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(message = "That picture is too large for this browser to keep.") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

/** Redraws a chosen file at the target size, cropped centrally to fill. Encoded to a Blob,
 * not a data URL — base64 inflates a picture by a third. */
export async function redraw(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError();

  if (!ACCEPTED[kind].includes(file.type)) {
    // A separate sentence for GIF-on-a-banner, which the avatar accepts happily.
    throw new Error(
      file.type === "image/gif"
        ? "Banners have to be a still picture — try a PNG, JPEG or WebP. GIFs work on your profile picture."
        : "That has to be a PNG, JPEG or WebP.",
    );
  }

  // An animated avatar is stored exactly as it arrived: a canvas has one frame, so drawing
  // a GIF to it silently flattens the animation. `MAX_ANIMATED_BYTES` does the resize's
  // job, and the type is re-checked so an edit to the banner's list cannot enable this.
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

  // The target is a **maximum**, and the redraw never upscales. Forcing every picture to
  // exactly 512×512 stretched a 200px avatar two and a half times, then re-encoded the
  // interpolated pixels at quality 0.82 — baking the upscale in permanently, larger in
  // bytes and softer than the original. The crop is a source rectangle: the largest
  // centred region with the target's aspect ratio.
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
      // Browsers that cannot encode WebP silently hand back a PNG rather than
      // failing, so the type is checked afterwards.
      canvas.toBlob((result) => resolve(result), "image/webp", 0.82);
    });

    if (blob && blob.type === "image/webp") return blob;

    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.85);
    });

    if (!jpeg) throw new Error("This browser couldn't encode that picture.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}
