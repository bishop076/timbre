"use client";

import { useRef, useState } from "react";

import { CameraIcon, SpinnerIcon, TrashIcon } from "../icons";
import { ACCEPTED } from "./image-resize";
import { clearLocalImage, setLocalImage, type ImageKind } from "./local-images";

export function useFilePicker(accept: string, fallback: string, onFile: (file: File) => unknown) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      onChange={(event) => void choose(event.target.files?.[0])}
      className="sr-only"
      aria-hidden
      tabIndex={-1}
    />
  );

  return { input, open: () => ref.current?.click(), busy, error, setError };
}

export function ImagePicker({
  kind,
  hasImage,
  variant,
}: {
  kind: ImageKind;
  hasImage: boolean;
  variant: "overlay" | "button";
}) {
  const picker = useFilePicker(ACCEPTED[kind].join(","), "Couldn't use that picture.", (file) =>
    setLocalImage(kind, file),
  );

  const overlay = variant === "overlay";
  const label = kind === "avatar" ? "profile picture" : "banner";
  const change = overlay || hasImage ? `Change ${label}` : `Add ${label}`;
  const icon = overlay ? "size-5" : "size-4";
  const button = overlay
    ? "press flex size-8 items-center justify-center rounded-[var(--r-full)] text-white hover:bg-white/20"
    : "slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur";

  return (
    <>
      {picker.input}

      <div
        className={
          overlay
            ? "absolute inset-0 flex items-center justify-center gap-1.5 rounded-full bg-black/55 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100"
            : "flex items-center gap-1.5"
        }
      >
        <button
          type="button"
          onClick={picker.open}
          disabled={picker.busy}
          aria-label={change}
          title={overlay ? `${change} — kept only on this device` : change}
          className={overlay ? button : `${button} disabled:opacity-50`}
        >
          {picker.busy ? (
            <SpinnerIcon className={`${icon} animate-spin`} />
          ) : (
            <CameraIcon className={icon} />
          )}
        </button>

        {hasImage && (
          <button
            type="button"
            onClick={() => {
              clearLocalImage(kind);
              picker.setError(null);
            }}
            aria-label={`Remove ${label}`}
            title={`Remove ${label}`}
            className={`${button} hover:text-red-300`}
          >
            <TrashIcon className="size-4" />
          </button>
        )}
      </div>

      {picker.error && (
        <p
          role="alert"
          className={`absolute top-full z-30 mt-2 w-56 rounded-[var(--r-sm)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-400 shadow-[var(--drop-lg)] ${
            overlay ? "left-0" : "right-0"
          }`}
        >
          {picker.error}
        </p>
      )}
    </>
  );
}
