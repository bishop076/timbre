"use client";

import { useEffect, useRef, useState } from "react";

import { VolumeIcon, VolumeMuteIcon } from "../icons";
import { usePlayer } from "./player-context";
import { VOLUME_STEP } from "./transport-keys";
import { pixelDelta, wheelSteps } from "./wheel-step";

/**
 * Output level — desktop only, since a phone's hardware keys own volume. Muting is drawn
 * as a level of zero, so the control can never show a level you cannot hear.
 */
export function Volume() {
  const { volume, muted, setVolume, toggleMute } = usePlayer();
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const level = muted ? 0 : volume;

  const applyFrom = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 1) return;
    // Divided by `width - 1`: addressable positions run 0 to `width - 1`, so the full
    // width mapped the far right to 98 — a visually full fill sitting under maximum.
    setVolume(((clientX - box.left) / (box.width - 1)) * 100);
  };

  // `setVolume` takes an absolute value, so a handler closing over `level` reads a stale
  // number the moment two wheel events land in one frame — every trackpad flick.
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  // A native listener with `passive: false`, not React's `onWheel` — React registers
  // wheel handlers at the root as passive, so `preventDefault` is ignored and the page
  // scrolls behind the control.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    let carried = 0;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      carried += pixelDelta(event.deltaY, event.deltaMode);
      const { steps, rest } = wheelSteps(carried);
      carried = rest;
      if (steps === 0) return;

      // Scrolling up is a negative delta and means louder, hence the subtraction.
      setVolume(levelRef.current - steps * VOLUME_STEP);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [setVolume]);

  return (
    <div ref={rootRef} className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg)]"
      >
        {muted ? <VolumeMuteIcon className="size-[18px]" /> : <VolumeIcon className="size-[18px]" />}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        title="Volume — drag, or scroll to adjust"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        aria-valuetext={muted ? "Muted" : `${level}%`}
        // Pointer capture rather than window listeners, so a drag that leaves the
        // track — most drags on a control this small — keeps working.
        onPointerDown={(event) => {
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
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") setVolume(level + 5);
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") setVolume(level - 5);
          if (event.key === "Home") setVolume(0);
          if (event.key === "End") setVolume(100);
        }}
        // Taller than the visible bar — a 10px target is unusable.
        className="group flex h-8 w-16 cursor-pointer touch-none items-center xl:w-24"
      >
        <div className="slab-sm relative h-2.5 w-full overflow-hidden rounded-[var(--r-full)] bg-[var(--surface-2)]">
          <div
            className="tint absolute inset-y-0 left-0 rounded-[var(--r-full)]"
            style={{ width: `${level}%`, background: "var(--accent)" }}
          />
        </div>
      </div>
    </div>
  );
}
