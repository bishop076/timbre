import type { ImageKind } from "./local-images";

const SIZES: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1600, height: 500 },
};

export const ACCEPTED: Record<ImageKind, string[]> = {
  avatar: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  banner: ["image/png", "image/jpeg", "image/webp"],
};

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

const MAX_ANIMATED_BYTES = 5 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(message = "That picture is too large for this browser to keep.") {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

export async function redraw(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError();

  if (!ACCEPTED[kind].includes(file.type)) {
    throw new Error(
      file.type === "image/gif"
        ? "Banners have to be a still picture — try a PNG, JPEG or WebP. GIFs work on your profile picture."
        : "That has to be a PNG, JPEG or WebP.",
    );
  }

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
