"use client";

import { useRef, useState } from "react";

import { CameraIcon, SpinnerIcon, TrashIcon } from "../icons";
import { clearLocalImage, setLocalImage, type ImageKind } from "./local-images";

/**
 * Choose or remove a local picture.
 *
 * Two shapes from one component, because the underlying act is identical and
 * only the surface differs: the avatar wants an overlay covering the circle,
 * the banner wants a button in its corner.
 *
 * Nothing uploads. The label says so — "Only on this device" is not a
 * disclaimer to bury, it is the reason there is no account picture to sync and
 * the first thing someone will wonder when the avatar is missing on their
 * phone.
 */
export function ImagePicker({
  kind,
  hasImage,
  variant,
  onChanged,
}: {
  kind: ImageKind;
  hasImage: boolean;
  variant: "overlay" | "button";
  /** Lets the parent clear an error or close a menu after a change. */
  onChanged?: () => void;
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
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't use that picture.");
    } finally {
      setBusy(false);
      // Cleared so choosing the same file twice still fires a change event.
      if (input.current) input.current.value = "";
    }
  }

  function remove() {
    clearLocalImage(kind);
    setError(null);
    onChanged?.();
  }

  const label = kind === "avatar" ? "profile picture" : "banner";

  return (
    <>
      <input
        ref={input}
        type="file"
        // Nudges phones towards the photo library rather than a file browser.
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        onChange={(event) => void choose(event.target.files?.[0])}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {variant === "overlay" ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={`Change ${label}`}
          title={`Change ${label} — only on this device`}
          /* Covers the avatar and appears on hover or keyboard focus. Opacity
             rather than conditional rendering, so it fades instead of popping
             and stays reachable by tab. */
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
        >
          {busy ? (
            <SpinnerIcon className="size-6 animate-spin" />
          ) : (
            <CameraIcon className="size-6" />
          )}
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="slab-sm press inline-flex items-center gap-1.5 rounded-[var(--r-full)] bg-black/45 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur disabled:opacity-50"
          >
            {busy ? (
              <SpinnerIcon className="size-3.5 animate-spin" />
            ) : (
              <CameraIcon className="size-3.5" />
            )}
            {hasImage ? "Change banner" : "Add banner"}
          </button>

          {hasImage && (
            <button
              type="button"
              onClick={remove}
              aria-label="Remove banner"
              className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur hover:text-red-300"
            >
              <TrashIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="absolute left-0 top-full z-30 mt-2 w-56 rounded-[var(--r-sm)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-400 shadow-[var(--drop-lg)]"
        >
          {error}
        </p>
      )}
    </>
  );
}

/**
 * Removes a local avatar. Separate from the overlay because the overlay fills
 * the circle and has no room for a second control inside it.
 */
export function RemoveAvatarButton({ onChanged }: { onChanged?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        clearLocalImage("avatar");
        onChanged?.();
      }}
      // Theme tones, not white. Unlike the other controls here this one has no
      // dark pill behind it — it sits inline in the stats row, which since the
      // header lost its colour wash is just the page. White was invisible on
      // every light theme.
      className="text-[11px] font-semibold text-[var(--fg-faint)] underline-offset-2 hover:text-[var(--fg)] hover:underline"
    >
      Remove picture
    </button>
  );
}
