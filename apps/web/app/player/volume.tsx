"use client";

import { useEffect, useRef, useState } from "react";

import { VolumeIcon, VolumeMuteIcon } from "../icons";
import { usePlayerControls } from "./player-context";
import { VOLUME_STEP } from "./transport-keys";
import { pixelDelta, wheelSteps } from "./wheel-step";

export function Volume() {
  const { volume, muted, setVolume, toggleMute } = usePlayerControls();
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const level = muted ? 0 : volume;

  const applyFrom = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 1) return;
    setVolume(((clientX - box.left) / (box.width - 1)) * 100);
  };

  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

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
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          const to =
            event.key === "ArrowRight" || event.key === "ArrowUp"
              ? level + 5
              : event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? level - 5
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 100
                    : null;

          if (to === null) return;
          event.preventDefault();
          setVolume(to);
        }}
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
