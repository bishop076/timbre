"use client";

import { useRef, useState } from "react";

import { VolumeIcon, VolumeMuteIcon } from "../icons";
import { usePlayer } from "./player-context";

/**
 * Output level.
 *
 * Desktop only, and that is not an omission: on a phone the hardware keys own
 * volume, and every phone music app leaves it to them rather than offering a
 * second control that fights the first.
 *
 * The button mutes, the track sets a level, and muting is drawn as a level of
 * zero rather than as a separate state — one reading, so the control can never
 * show a level you cannot hear.
 */
export function Volume() {
  const { volume, muted, setVolume, toggleMute } = usePlayer();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const level = muted ? 0 : volume;

  const applyFrom = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setVolume(((clientX - box.left) / box.width) * 100);
  };

  return (
    <div className="flex items-center gap-1.5">
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
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        aria-valuetext={muted ? "Muted" : `${level}%`}
        // Pointer capture rather than window listeners: the pointer keeps
        // reporting to this element once it is captured, so a drag that leaves
        // the track — which is most drags on a control this small — keeps
        // working instead of stopping at the edge.
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
        // The hit area is taller than the visible bar, because a 10px target is
        // unusable with a mouse.
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
