"use client";

import { useRef, useState } from "react";

import { CameraIcon, SpinnerIcon, TrashIcon } from "../icons";
import { clearLocalImage, setLocalImage, type ImageKind } from "./local-images";

/** Choose or remove a local picture, as an overlay on the avatar's circle or a button in the
 * banner's corner. Nothing uploads, and the label says so. */
export function ImagePicker({
  kind,
  hasImage,
  variant,
}: {
  kind: ImageKind;
  hasImage: boolean;
  variant: "overlay" | "button";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await setLocalImage(kind, file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't use that picture.");
    } finally {
      setBusy(false);
      // Or choosing the same file twice fires no change event.
      if (input.current) input.current.value = "";
    }
  }

  function remove() {
    clearLocalImage(kind);
    setError(null);
  }

  const label = kind === "avatar" ? "profile picture" : "banner";

  return (
    <>
      <input
        ref={input}
        type="file"
        /*
          GIF on the avatar, stills on the banner — see `ACCEPTED` in
          `image-resize.ts`. A hint, never the check: `accept` only filters the
          picker's default view, and "all files" is one dropdown away. The refusal
          that matters is in `redraw`.
        */
        accept={
          kind === "avatar"
            ? "image/png,image/jpeg,image/webp,image/gif"
            : "image/png,image/jpeg,image/webp"
        }
        onChange={(event) => void choose(event.target.files?.[0])}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {variant === "overlay" ? (
        // A button may not contain another, and the overlay needs two.
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-full bg-black/55 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            aria-label={`Change ${label}`}
            title={`Change ${label} — kept only on this device`}
            className="press flex size-8 items-center justify-center rounded-[var(--r-full)] text-white hover:bg-white/20"
          >
            {busy ? (
              <SpinnerIcon className="size-5 animate-spin" />
            ) : (
              <CameraIcon className="size-5" />
            )}
          </button>

          {hasImage && (
            <button
              type="button"
              onClick={remove}
              aria-label={`Remove ${label}`}
              title={`Remove ${label}`}
              className="press flex size-8 items-center justify-center rounded-[var(--r-full)] text-white hover:bg-white/20 hover:text-red-300"
            >
              <TrashIcon className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {/* A circle, not a labelled pill — the word made this the widest object in a
              cluster of three. The label survives in `aria-label` and `title`. */}
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            aria-label={hasImage ? `Change ${label}` : `Add ${label}`}
            title={hasImage ? `Change ${label}` : `Add ${label}`}
            className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur disabled:opacity-50"
          >
            {busy ? (
              <SpinnerIcon className="size-4 animate-spin" />
            ) : (
              <CameraIcon className="size-4" />
            )}
          </button>

          {hasImage && (
            <button
              type="button"
              onClick={remove}
              aria-label={`Remove ${label}`}
              title={`Remove ${label}`}
              className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur hover:text-red-300"
            >
              <TrashIcon className="size-4" />
            </button>
          )}
        </div>
      )}

      {/*
        Anchored to whichever side the control sits on: `left-0` under the avatar in
        mid-header, right-anchored for the banner's corner button, where the same rule
        ran a 224px-wide box off the edge of the page.
      */}
      {error && (
        <p
          role="alert"
          className={`absolute top-full z-30 mt-2 w-56 rounded-[var(--r-sm)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-400 shadow-[var(--drop-lg)] ${
            variant === "overlay" ? "left-0" : "right-0"
          }`}
        >
          {error}
        </p>
      )}
    </>
  );
}
