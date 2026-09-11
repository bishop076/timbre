import type { ImageKind } from "./local-images";

const SIZES: Record<ImageKind, [number, number]> = { avatar: [512, 512], banner: [1600, 500] };

export const ACCEPTED: Record<ImageKind, string[]> = {
  avatar: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  banner: ["image/png", "image/jpeg", "image/webp"],
};

export async function redraw(file: File, kind: ImageKind): Promise<Blob> {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("That picture is too large for this browser to keep.");
  }

  if (!ACCEPTED[kind].includes(file.type)) {
    throw new Error(
      file.type === "image/gif"
        ? "Banners have to be a still picture — try a PNG, JPEG or WebP. GIFs work on your profile picture."
        : "That has to be a PNG, JPEG or WebP.",
    );
  }

  if (kind === "avatar" && file.type === "image/gif") {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error(
        "That GIF is too large — animated pictures are kept at full size, so they have to be under 5MB.",
      );
    }
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const [maxWidth, maxHeight] = SIZES[kind];

  const cropWidth = Math.min(bitmap.width, (bitmap.height * maxWidth) / maxHeight);
  const cropHeight = Math.min(bitmap.height, (bitmap.width * maxHeight) / maxWidth);
  const shrink = Math.min(1, maxWidth / cropWidth);
  const width = Math.max(1, Math.round(cropWidth * shrink));
  const height = Math.max(1, Math.round(cropHeight * shrink));

  try {
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't process images.");

    context.imageSmoothingQuality = "high";
    const left = (bitmap.width - cropWidth) / 2;
    const top = (bitmap.height - cropHeight) / 2;
    context.drawImage(bitmap, left, top, cropWidth, cropHeight, 0, 0, width, height);

    const encode = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

    const webp = await encode("image/webp", 0.82);
    if (webp?.type === "image/webp") return webp;

    const jpeg = await encode("image/jpeg", 0.85);
    if (!jpeg) throw new Error("This browser couldn't encode that picture.");
    return jpeg;
  } finally {
    bitmap.close();
  }
}
