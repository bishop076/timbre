"use client";

import { useEffect, useRef, useState } from "react";

import { VolumeIcon, VolumeMuteIcon } from "../icons";
import { usePlayerControls } from "./player-context";
import { VOLUME_STEP } from "./transport-keys";
import { getVolumeSnapshot, useVolume, writeMuteToggle, writeVolume } from "./volume-store";
import { pixelDelta, wheelSteps } from "./wheel-step";

export function Volume() {
  const { volume, muted } = useVolume();
  // Three of the eight players take no level from us — see `volume-reach.ts`. The control stays
  // where it is and says why rather than disappearing, because a control that comes and goes as
  // the queue moves between sources reads as the app losing a feature.
  const { volumeUnreachable } = usePlayerControls();
  const reason = volumeUnreachable;
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const level = muted ? 0 : volume;

  const applyFrom = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 1) return;
    writeVolume(((clientX - box.left) / (box.width - 1)) * 100);
  };

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    let carried = 0;
    const onWheel = (event: WheelEvent) => {
      if (reason) return;
      event.preventDefault();
      carried += pixelDelta(event.deltaY, event.deltaMode);
      const { steps, rest } = wheelSteps(carried);
      carried = rest;
      if (steps === 0) return;
      const current = getVolumeSnapshot();
      writeVolume((current.muted ? 0 : current.volume) - steps * VOLUME_STEP);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [reason]);

  return (
    <div ref={rootRef} className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={writeMuteToggle}
        disabled={reason !== null}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        title={reason ?? undefined}
        className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {muted ? <VolumeMuteIcon className="size-[18px]" /> : <VolumeIcon className="size-[18px]" />}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={reason ? -1 : 0}
        aria-label="Volume"
        aria-disabled={reason !== null}
        title={reason ?? "Volume — drag, or scroll to adjust"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        aria-valuetext={reason ?? (muted ? "Muted" : `${level}%`)}
        onPointerDown={(event) => {
          if (reason) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          applyFrom(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging) applyFrom(event.clientX);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (reason) return;
          const to =
            event.key === "ArrowRight" || event.key === "ArrowUp"
              ? level + VOLUME_STEP
              : event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? level - VOLUME_STEP
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 100
                    : null;
          if (to === null) return;
          event.preventDefault();
          writeVolume(to);
        }}
        className={`group flex h-8 w-16 touch-none items-center rounded-[var(--r-full)] xl:w-24 ${
          reason ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        }`}
      >
        {/* Nothing here changes size on hover. A track that fattens under the pointer moves the
            fill out from under it, and the volume you land on is not the one you aimed at — so the
            hover and drag states are carried entirely by the knob's opacity. The knob sits outside
            the clipped track, which is what lets it overhang the ink edge instead of being cut by
            it, and it is inset by half its width so it never hangs off either end. */}
        <div className="relative w-full">
          <div className="slab-sm h-2.5 w-full overflow-hidden rounded-[var(--r-full)] bg-[var(--surface-2)]">
            <div
              className="tint h-full rounded-[var(--r-full)]"
              style={{ width: `${level}%`, background: "var(--accent)" }}
            />
          </div>
          <span
            aria-hidden
            className={`slab-sm pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[var(--r-full)] bg-[var(--surface-1)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${
              dragging ? "opacity-100" : "opacity-0"
            }`}
            style={{ left: `calc(${level}% + ${(7 - (level / 100) * 14).toFixed(2)}px)` }}
          />
        </div>
      </div>
    </div>
  );
}
