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
        /*
          Nudges phones towards the photo library rather than a file browser,
          and offers each picture only what it will take — GIF on the avatar,
          stills on the banner. See `ACCEPTED` in `image-resize.ts`.

          A hint, never the check. `accept` filters the picker's default view
          and nothing else: "all files" is one dropdown away, and a drag-and-drop
          never consults it at all. The refusal that matters is in `redraw`.
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
        /*
          Both actions live on the picture itself.
          Removing used to be a text link sitting in the stats row, which put a
          destructive control in a line of figures and made someone read the
          word "remove" every time they looked at their own follower count. A
          control belongs on the thing it acts on.

          A container of buttons rather than one full-cover button: a button may
          not contain another, and the overlay needs two.
        */
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
          {/*
            A circle like the ones either side of it, not a labelled pill.

            The word made this the widest object in a cluster of three, so a row
            of small round controls had one long capsule wedged into the middle
            of it. The camera says the same thing in a quarter of the width, and
            the label survives where it is needed — `aria-label` for a screen
            reader, `title` for anyone unsure on a pointer.
          */}
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
        Anchored to whichever side the control sits on.

        `left-0` is right under the avatar, which is in the middle of the header.
        The banner's button is in the top-right corner, where the same rule ran a
        224px-wide box off the edge of the page — so that one hangs from its right
        edge instead. Both are positioned against the picker's own wrapper: see
        the `relative` on the banner cluster in `profile-view.tsx`, and the note
        there about why the avatar's outer box must not clip.
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
